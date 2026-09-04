"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectHostDevice, type HostDevice } from "../../../../lib/host-device";
import { formatPartyStart, formatPlaybackTime, durationMilliseconds as trackDurationMilliseconds, hostSongOutcome } from "../../../../lib/party-format";
import type { HostParty, HostTransfer } from "../../../../lib/party-contract";
import { extractSpotifyTrackId } from "../../../../lib/spotify-track";
import { trackSource, type TrackSource } from "../../../../lib/track-link";
import { extractYouTubeVideoId, youtubeThumbnailUrl } from "../../../../lib/youtube-track";
import { isDevelopmentHost } from "../../../../lib/dev-only";
import { participantStorageKey, personaFromSearch } from "../../../../lib/party-storage";
import type { SpotifyPlaybackState, SpotifyPlayer, SpotifyProgress } from "./spotify-sdk";
import { useReactionSounds, type MusicVolumeControl } from "./use-reaction-sounds";
import HostEffects, { HostEffectsBoundary, burstEmojisFor, makeBursts, type HostAlert, type HostBurst } from "./host-effects";
import { boosNeededToSkip, MAX_THEME_LENGTH } from "../../../../lib/party-fun";
import { shareRecapCard } from "../../../../lib/recap-card";
import { useHostEventLog } from "./use-host-event-log";
import { useReadinessCheck } from "./use-readiness-check";
import { useScreenWakeLock } from "./use-screen-wake-lock";
import { useYouTubePlayer } from "./use-youtube-player";
import { youtubeErrorMessage } from "./youtube-sdk";

type PlaybackSnapshot = { trackId: string; position: number; duration: number; paused: boolean; receivedAt: number };

const queueModes = [
  { id: "ordered", icon: "📬", title: "Submitted order", copy: "First submitted, first played. Predictable and tidy." },
  { id: "random", icon: "🎲", title: "Pure chaos", copy: "Every waiting song has an equal shot at being next." },
  { id: "fair", icon: "⚖️", title: "Fair-ish shuffle", copy: "People heard least go first; ties stay delightfully random." },
] as const;

export default function HostRoom({ code }: { code: string }) {
  const [party, setParty] = useState<HostParty | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [replacementPasscode, setReplacementPasscode] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncProblem, setSyncProblem] = useState("");
  const [roomSyncing, setRoomSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffInvite, setHandoffInvite] = useState<(HostTransfer & { url: string }) | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffToken, setHandoffToken] = useState("");
  const [handoffClaimBusy, setHandoffClaimBusy] = useState(false);
  const [handoffClaimError, setHandoffClaimError] = useState("");
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [bursts, setBursts] = useState<HostBurst[]>([]);
  const [hostAlert, setHostAlert] = useState<HostAlert | null>(null);
  const [shaking, setShaking] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [themeDraft, setThemeDraft] = useState("");
  const [themeBusy, setThemeBusy] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyStatus, setSpotifyStatus] = useState<"checking" | "disconnected" | "loading" | "ready" | "error">("checking");
  const [spotifyDeviceId, setSpotifyDeviceId] = useState("");
  const [speakerArmed, setSpeakerArmed] = useState(false);
  const [speakerStarting, setSpeakerStarting] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState<SpotifyProgress>({ position: 0, duration: 0, paused: true, trackUri: "" });
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [youtubeMessage, setYoutubeMessage] = useState("");
  const [hostDevice, setHostDevice] = useState<HostDevice>("unknown");
  const knownSoundActivityRef = useRef<Set<string> | null>(null);
  const knownFlairRef = useRef<Set<string> | null>(null);
  const cheerStreakRef = useRef(0);
  const previousBooCountRef = useRef<{ trackId: string; boos: number; shielded: boolean }>({ trackId: "", boos: 0, shielded: false });
  const previousLeaderRef = useRef<string | null>(null);
  const knownOutcomesRef = useRef<Set<string> | null>(null);
  const alertTimerRef = useRef<number | null>(null);
  const { log: logHostEvent, read: readHostEvents } = useHostEventLog();
  const soundActivityCursorRef = useRef("");
  const cancelEndRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const closeHandoffRef = useRef<HTMLButtonElement | null>(null);
  const closeReadinessRef = useRef<HTMLButtonElement | null>(null);
  const spotifyPlayerRef = useRef<SpotifyPlayer | null>(null);
  const lastStartedTrackRef = useRef("");
  const previousPartyTrackRef = useRef("");
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null);
  const lastPlaybackSnapshotRef = useRef<PlaybackSnapshot | null>(null);
  const spotifyStateReceivedAtRef = useRef(0);
  const spotifyEndTimerRef = useRef<number | null>(null);
  const advancingTrackRef = useRef(false);
  const roomRefreshInFlightRef = useRef(false);
  const activeSourceRef = useRef<TrackSource | null>(null);
  const currentTrackIdRef = useRef("");
  const currentTrackId = party?.currentTrack?.id ?? "";
  const currentSource: TrackSource | null = currentTrackId ? trackSource(currentTrackId) : null;
  const currentSpotifyId = currentSource === "spotify" ? extractSpotifyTrackId(currentTrackId) : "";
  const currentYouTubeId = currentSource === "youtube" ? extractYouTubeVideoId(currentTrackId) : "";
  useEffect(() => {
    activeSourceRef.current = currentSource;
    currentTrackIdRef.current = currentTrackId;
  }, [currentSource, currentTrackId]);
  const partyStatus = party?.status;
  const partyEnded = partyStatus === "ended";
  const partyMusicSource = party?.musicSource ?? "spotify";
  const hostDeviceName = hostDevice === "ios" ? "iPhone / iPad" : hostDevice === "android" ? "Android device" : hostDevice === "computer" ? "computer" : "device";
  const hostReady = Boolean(participantId && hostKey && !partyEnded);
  // Neither connector starts until the room has loaded and declared its source.
  const spotifyRoom = party?.musicSource === "spotify";
  const youtubeRoom = party?.musicSource === "youtube";

  const advanceTrack = useCallback(async (outcome: "advance" | "skip", reason: string) => {
    if (advancingTrackRef.current) { logHostEvent("advance ignored", `${reason} (another advance already in flight)`); return; }
    advancingTrackRef.current = true;
    lastStartedTrackRef.current = "";
    logHostEvent(outcome === "skip" ? "auto-skip requested" : "advance requested", `${reason} · current ${currentTrackIdRef.current || "none"}`);
    try {
      const response = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: outcome, code, participantId, pin: hostKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not advance the playlist.");
      setParty(data.party);
    } catch (reason) {
      advancingTrackRef.current = false;
      throw reason;
    }
  }, [code, hostKey, logHostEvent, participantId]);
  const advanceTrackRef = useRef(advanceTrack);
  useEffect(() => { advanceTrackRef.current = advanceTrack; }, [advanceTrack]);

  const youtube = useYouTubePlayer({
    enabled: hostReady && youtubeRoom,
    onEnded: (videoId) => {
      if (videoId !== extractYouTubeVideoId(currentTrackIdRef.current)) { logHostEvent("youtube ended (ignored)", `video ${videoId} is not the current track`); return; }
      setYoutubeMessage("🎬 Video finished. Loading the next secret song…");
      void advanceTrackRef.current("advance", `YouTube reported video ${videoId} ended`).catch((reason) => setYoutubeMessage(reason instanceof Error ? reason.message : "Could not play the next song."));
    },
    onError: (videoId, errorCode) => {
      if (videoId !== extractYouTubeVideoId(currentTrackIdRef.current)) { logHostEvent("youtube error (ignored)", `code ${errorCode} for ${videoId}, not the current track`); return; }
      setYoutubeMessage(`⚠️ ${youtubeErrorMessage(errorCode)} Skipping it for the room.`);
      void advanceTrackRef.current("skip", `YouTube error ${errorCode} on video ${videoId}: ${youtubeErrorMessage(errorCode)}`).catch((reason) => setYoutubeMessage(reason instanceof Error ? reason.message : "Could not skip that video. Use the skip button."));
    },
    onProgress: (progress) => {
      if (activeSourceRef.current !== "youtube") return;
      const trackId = `youtube:video:${progress.videoId}`;
      lastPlaybackSnapshotRef.current = { trackId, position: progress.position, duration: progress.duration, paused: progress.paused, receivedAt: Date.now() };
      setPlaybackProgress({ position: progress.position, duration: progress.duration, paused: progress.paused, trackUri: trackId });
    },
  });
  // The hook's functions are stable (useCallback with fixed deps), so they can be captured once below.
  const { status: youtubeStatus, needsTap: youtubeNeedsTap, attachStage: attachYouTubeStage, play: playYouTube, stop: stopYouTube, getVolume: getYouTubeVolume, setVolume: setYouTubeVolume } = youtube;
  const musicControlRef = useRef<MusicVolumeControl>({
    getVolume: async () => {
      if (activeSourceRef.current === "youtube") return getYouTubeVolume();
      const player = spotifyPlayerRef.current;
      return player ? player.getVolume() : 0.8;
    },
    setVolume: async (volume) => {
      if (activeSourceRef.current === "youtube") return setYouTubeVolume(volume);
      await spotifyPlayerRef.current?.setVolume(volume);
    },
  });
  const { enabled: audioEnabled, play: playReactionSound, playEffect, enableAndTest: enableReactionAudio, disable: disableReactionAudio, inspect: inspectReactionAudio } = useReactionSounds(musicControlRef, setMessage);

  const spawnBursts = useCallback((kind: "up" | "down" | "flair", emojis: string[], avatar?: string) => {
    const fresh = makeBursts(kind, emojis, avatar);
    setBursts((current) => [...current.slice(-60), ...fresh]);
    const ids = new Set(fresh.map((burst) => burst.id));
    window.setTimeout(() => setBursts((current) => current.filter((burst) => !ids.has(burst.id))), 3_200);
    if (kind === "down") {
      setShaking(true);
      window.setTimeout(() => setShaking(false), 650);
    }
  }, []);

  const showAlert = useCallback((alert: Omit<HostAlert, "id">, durationMs = 2_600) => {
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    setHostAlert({ ...alert, id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
    alertTimerRef.current = window.setTimeout(() => setHostAlert(null), durationMs);
  }, []);

  const pullThePlug = useCallback((title: string) => {
    logHostEvent("booed off (server)", title);
    setBlackout(true);
    playEffect("scratch", `plug pulled: ${title}`);
    window.setTimeout(() => playEffect("slam", `plug pulled: ${title}`), 350);
    showAlert({ kind: "plug-pulled", title: "🔌 PLUG PULLED", detail: "The crowd has spoken. Next song." }, 2_400);
    setShaking(true);
    window.setTimeout(() => setShaking(false), 900);
    window.setTimeout(() => setBlackout(false), 1_400);
  }, [logHostEvent, playEffect, showAlert]);
  const { supported: wakeLockSupported, active: wakeLockActive, request: requestScreenWakeLock, release: releaseScreenWakeLock } = useScreenWakeLock(hostDeviceName, setMessage);
  const { running: readinessRunning, results: readinessResults, checkedAt: readinessCheckedAt, run: runReadinessCheck } = useReadinessCheck();
  const wakeLockStatus = wakeLockActive
    ? `✅ This ${hostDeviceName} will stay awake while the host tab remains visible.`
    : wakeLockSupported === false
      ? `⚠️ Automatic wake lock is unavailable here. Open the ${hostDeviceName} fallback below.`
      : `💤 Keep this ${hostDeviceName} awake during the party.`;

  useEffect(() => {
    const persona = isDevelopmentHost(window.location.hostname) ? personaFromSearch(window.location.search) : "";
    const participant = window.localStorage.getItem(participantStorageKey(code, persona)) ?? "";
    const key = window.localStorage.getItem(`hackmusic:${code}:host`) ?? "";
    const savedSpotifyClientId = window.localStorage.getItem("hackmusic:spotify:clientId") ?? "";
    const savedJoinPasscode = window.localStorage.getItem(`hackmusic:${code}:joinPasscode`) ?? "";
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("handoff") ?? "";
    const url = `${window.location.origin}/e/${code}`;
    if (fragmentToken) window.sessionStorage.setItem(`hackmusic:${code}:handoff`, fragmentToken);
    queueMicrotask(() => {
      setParticipantId(participant);
      setHostKey(key);
      setShareUrl(url);
      setSpotifyClientId(savedSpotifyClientId);
      setJoinPasscode(savedJoinPasscode);
      setHandoffToken(fragmentToken);
      setHostDevice(detectHostDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
      if ((!participant || !key) && !fragmentToken) setError("This browser does not hold the current host key, so its controls are locked.");
    });
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#151515", light: "#fffef9" } }).then(setQrUrl).catch(() => undefined);
  }, [code]);

  useEffect(() => {
    const updateProgress = () => {
      const state = lastPlaybackStateRef.current;
      if (!state || activeSourceRef.current !== "spotify") return;
      const position = state.paused
        ? state.position
        : Math.min(state.duration, state.position + Math.max(0, Date.now() - spotifyStateReceivedAtRef.current));
      setPlaybackProgress({
        position,
        duration: state.duration,
        paused: state.paused,
        trackUri: state.track_window.current_track.uri,
      });
    };
    const timer = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(timer);
  }, []);

  const runReactionEffects = useCallback((snapshot: HostParty, incomingActivity: Array<{ id: string; tone: "up" | "down" | "song"; createdAt: string }>, incomingFlair: Array<{ id: string; emoji: string; avatar: string }>) => {
    const seeded = knownSoundActivityRef.current !== null;
    const knownIds = knownSoundActivityRef.current ?? new Set<string>();
    const fresh = incomingActivity.filter((item) => !knownIds.has(item.id));
    incomingActivity.forEach((item) => knownIds.add(item.id));
    knownSoundActivityRef.current = knownIds;
    if (seeded) {
      // A burst of reactions plays as a swelling crowd: each one a third of a second later and a touch higher in pitch,
      // so four cheers sound like four cheers instead of one thick clip.
      let soundIndex = 0;
      fresh.forEach((item) => {
        if (item.tone === "song") { cheerStreakRef.current = 0; return; }
        const tone = item.tone as "up" | "down";
        const position = Math.min(soundIndex, 9);
        const delay = position * 330;
        const pitch = 1 + position * 0.04;
        soundIndex += 1;
        window.setTimeout(() => {
          try {
            playReactionSound(tone, `${tone === "up" ? "cheer" : "boo"} activity ${item.id} at ${item.createdAt}${position ? ` (#${position + 1} in burst)` : ""}`, pitch);
            spawnBursts(tone, burstEmojisFor(tone));
          } catch (reason) {
            console.error("HackMusic: reaction effect failed.", reason);
          }
        }, delay);
        cheerStreakRef.current = tone === "up" ? cheerStreakRef.current + 1 : 0;
        if (cheerStreakRef.current === 3) showAlert({ kind: "streak", title: "🔥 THREE CHEERS IN A ROW", detail: "This song is winning the room." });
      });
    }
    const flairSeeded = knownFlairRef.current !== null;
    const knownFlair = knownFlairRef.current ?? new Set<string>();
    const freshFlair = incomingFlair.filter((item) => !knownFlair.has(item.id));
    incomingFlair.forEach((item) => knownFlair.add(item.id));
    knownFlairRef.current = knownFlair;
    if (flairSeeded) freshFlair.slice(0, 12).forEach((item, index) => window.setTimeout(() => spawnBursts("flair", [item.emoji, item.emoji], item.avatar), index * 90));
    // Boo-meter drama: warn on the penultimate boo, pull the plug when a song is booed off.
    const trackId = snapshot.currentTrack?.id ?? "";
    const shielded = Boolean(snapshot.currentTrack?.shielded);
    const boosNow = snapshot.reactions.filter((reaction) => reaction.tone === "down").length;
    const previousBoo = previousBooCountRef.current;
    if (trackId && previousBoo.trackId === trackId) {
      if (shielded && !previousBoo.shielded) showAlert({ kind: "shield", title: "🛡️ SHIELD UP", detail: `This song now needs ${boosNeededToSkip(true)} boos.` });
      if (boosNow > previousBoo.boos && boosNow === boosNeededToSkip(shielded) - 1) {
        playEffect("sting", `boo ${boosNow} of ${boosNeededToSkip(shielded)} on ${trackId}`);
        showAlert({ kind: "boo-warning", title: "😬 ONE MORE BOO…", detail: "The plug is in someone's hand." }, 3_200);
      }
    }
    previousBooCountRef.current = { trackId, boos: boosNow, shielded };
    // Plug-pulled is keyed on outcomes never seen before, so list ordering can never re-trigger it.
    const knownOutcomes = knownOutcomesRef.current;
    if (knownOutcomes) {
      const freshBooSkip = snapshot.songHistory.find((track) => !knownOutcomes.has(track.queueId) && track.skipReason === "boos");
      if (freshBooSkip) pullThePlug(freshBooSkip.title);
    }
    knownOutcomesRef.current = new Set(snapshot.songHistory.map((track) => track.queueId));
    const leader = [...snapshot.people].sort((left, right) => right.score - left.score)[0];
    if (leader && previousLeaderRef.current !== null && previousLeaderRef.current !== leader.id && snapshot.status === "live") {
      showAlert({ kind: "leader", title: `👑 NEW LEADER: ${leader.name}`, detail: `${leader.score} points and climbing.` });
    }
    previousLeaderRef.current = leader?.id ?? "";
  }, [playEffect, playReactionSound, pullThePlug, showAlert, spawnBursts]);

  const refreshParty = useCallback(async (announce = false) => {
    if (!participantId || !hostKey || roomRefreshInFlightRef.current) return false;
    roomRefreshInFlightRef.current = true;
    if (announce) setRoomSyncing(true);
    try {
      const response = await fetch(`/api/party?code=${encodeURIComponent(code)}&activityAfter=${encodeURIComponent(soundActivityCursorRef.current)}`, { headers: { "x-hackmusic-participant": participantId, "x-hackmusic-host-key": hostKey } });
      const data = await response.json().catch(() => null) as { error?: string; party?: HostParty & { activity?: Array<{ id: string; tone: "up" | "down" | "song"; createdAt: string }> } } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          window.localStorage.removeItem(`hackmusic:${code}:host`);
          spotifyPlayerRef.current?.disconnect();
          spotifyPlayerRef.current = null;
          setSpeakerArmed(false);
          disableReactionAudio();
          void releaseScreenWakeLock(false);
          setHostKey("");
          setParty(null);
          setError(data?.error ?? "This browser no longer has access to the host controls.");
          return false;
        }
        throw new Error(data?.error ?? "The party service is briefly unavailable.");
      }
      if (!data?.party || !Array.isArray(data.party.queuedTracks)) {
        setError("This browser no longer has the host key for this room.");
        return false;
      }
      // Room data is applied first and unconditionally. Sounds and visual effects run afterwards, isolated, so a hiccup
      // there can never freeze the host view, mark the room as offline, or touch playback.
      const incomingActivity = data.party.activity ?? [];
      const incomingFlair = data.party.flair ?? [];
      const lastActivity = incomingActivity[incomingActivity.length - 1];
      if (lastActivity) soundActivityCursorRef.current = `${lastActivity.createdAt}|${lastActivity.id}`;
      setParty(data.party);
      setError("");
      setSyncProblem("");
      if (announce) setMessage("✅ Room data refreshed. The music kept playing without interruption.");
      try {
        runReactionEffects(data.party, incomingActivity, incomingFlair);
      } catch (reason) {
        console.error("HackMusic: reaction effects skipped this round.", reason);
      }
      return true;
    } catch {
      setSyncProblem("HackMusic briefly lost the party service. Music playback is untouched, and room data will retry automatically.");
      if (announce) setMessage("⚠️ Still reconnecting to room data. The music keeps playing.");
      return false;
    } finally {
      roomRefreshInFlightRef.current = false;
      if (announce) setRoomSyncing(false);
    }
  }, [code, disableReactionAudio, hostKey, participantId, releaseScreenWakeLock, runReactionEffects]);

  useEffect(() => {
    if (!participantId || !hostKey || partyStatus === "ended") return;
    const initialRefresh = window.setTimeout(() => { void refreshParty(); }, 0);
    const timer = window.setInterval(() => { void refreshParty(); }, 2000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [hostKey, participantId, partyStatus, refreshParty]);

  useEffect(() => {
    if (!speakerArmed || partyEnded) return;
    const protectPlayback = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPlayback);
    return () => window.removeEventListener("beforeunload", protectPlayback);
  }, [partyEnded, speakerArmed]);

  useEffect(() => {
    if (!endConfirmOpen) return;
    const focusFrame = window.requestAnimationFrame(() => cancelEndRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEndConfirmOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [endConfirmOpen]);

  useEffect(() => {
    if (!renameOpen) return;
    const focusFrame = window.requestAnimationFrame(() => renameInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !renameBusy) setRenameOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [renameBusy, renameOpen]);

  useEffect(() => {
    if (!readinessOpen) return;
    const focusFrame = window.requestAnimationFrame(() => closeReadinessRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReadinessOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [readinessOpen]);

  useEffect(() => {
    if (!handoffOpen) return;
    const focusFrame = window.requestAnimationFrame(() => closeHandoffRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHandoffOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [handoffOpen]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const getSpotifyToken = useCallback(async () => {
    const response = await fetch("/api/spotify/token", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.accessToken) throw new Error(data.error ?? "Spotify is not connected.");
    return data.accessToken as string;
  }, []);

  useEffect(() => {
    if (!participantId || !hostKey || partyEnded || !spotifyRoom) return;
    let active = true;

    async function initializeSpotify() {
      try {
        await getSpotifyToken();
        if (!active) return;
        setSpotifyStatus("loading");

        const startPlayer = async () => {
          if (!active || !window.Spotify || spotifyPlayerRef.current) return;
          const player = new window.Spotify.Player({
            name: "HackMusic Speaker",
            getOAuthToken: (callback) => {
              void getSpotifyToken().then(callback).catch((reason) => {
                if (!active) return;
                setSpotifyStatus("error");
                setSpotifyMessage(reason instanceof Error ? reason.message : "Spotify login expired.");
              });
            },
            volume: 0.8,
            enableMediaSession: true,
          });

          player.addListener("ready", ({ device_id }) => {
            if (!active) return;
            setSpotifyDeviceId(device_id);
            setSpotifyStatus("ready");
            setSpotifyMessage("✅ Spotify Premium is connected. Start the speaker once, then HackMusic takes over.");
          });
          player.addListener("not_ready", () => {
            if (!active) return;
            setSpotifyDeviceId("");
            setSpotifyStatus("error");
            setSpotifyMessage("This Spotify speaker went offline. Reload this host page to reconnect it.");
          });
          player.addListener("autoplay_failed", () => {
            if (active) setSpotifyMessage("Your browser blocked autoplay. Tap Start the speaker again.");
          });
          player.addListener("initialization_error", ({ message: detail }) => {
            if (active) { setSpotifyStatus("error"); setSpotifyMessage(detail); }
          });
          player.addListener("authentication_error", ({ message: detail }) => {
            if (active) { setSpotifyStatus("error"); setSpotifyMessage(`${detail} Connect Spotify again.`); }
          });
          player.addListener("account_error", ({ message: detail }) => {
            if (active) { setSpotifyStatus("error"); setSpotifyMessage(`${detail} Spotify Premium is required.`); }
          });
          player.addListener("playback_error", ({ message: detail }) => {
            if (active) setSpotifyMessage(detail);
          });
          player.addListener("player_state_changed", (state) => {
            if (!active) return;
            const previous = lastPlaybackStateRef.current;
            lastPlaybackStateRef.current = state;
            spotifyStateReceivedAtRef.current = Date.now();
            if (state) {
              lastPlaybackSnapshotRef.current = { trackId: state.track_window.current_track.uri, position: state.position, duration: state.duration, paused: state.paused, receivedAt: Date.now() };
              if (activeSourceRef.current === "spotify") setPlaybackProgress({ position: state.position, duration: state.duration, paused: state.paused, trackUri: state.track_window.current_track.uri });
            } else if (activeSourceRef.current === "spotify") {
              setPlaybackProgress({ position: 0, duration: 0, paused: true, trackUri: "" });
            }
            if (state && spotifyEndTimerRef.current) {
              window.clearTimeout(spotifyEndTimerRef.current);
              spotifyEndTimerRef.current = null;
            }
            const naturallyFinished = Boolean(
              state && previous &&
              previous.track_window.current_track.uri === state.track_window.current_track.uri &&
              !previous.paused && state.paused && state.position === 0 &&
              previous.duration > 0
            );
            const moveToNext = () => {
              if (!active || activeSourceRef.current !== "spotify") return;
              if (state && state.track_window.current_track.uri !== currentTrackIdRef.current) return;
              void advanceTrackRef.current("advance", naturallyFinished ? "Spotify reported the track finished" : "Spotify end timer elapsed").catch((reason) => {
                if (active) setSpotifyMessage(reason instanceof Error ? reason.message : "Could not play the next song.");
              });
            };
            if (naturallyFinished) {
              moveToNext();
            } else if (state && !state.paused && state.duration > state.position) {
              spotifyEndTimerRef.current = window.setTimeout(moveToNext, state.duration - state.position + 1_250);
            }
          });

          spotifyPlayerRef.current = player;
          const connected = await player.connect();
          if (!connected && active) {
            setSpotifyStatus("error");
            setSpotifyMessage("Spotify could not create this browser speaker. Reload and try again.");
          }
        };

        if (window.Spotify) {
          await startPlayer();
        } else {
          window.onSpotifyWebPlaybackSDKReady = () => { void startPlayer(); };
          if (!document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
            const script = document.createElement("script");
            script.src = "https://sdk.scdn.co/spotify-player.js";
            script.async = true;
            script.onerror = () => {
              if (active) { setSpotifyStatus("error"); setSpotifyMessage("Could not load Spotify's player. Check your connection and reload."); }
            };
            document.body.appendChild(script);
          }
        }
      } catch (reason) {
        if (!active) return;
        const detail = reason instanceof Error ? reason.message : "Spotify is not connected.";
        setSpotifyStatus(detail.includes("not connected") ? "disconnected" : "error");
        setSpotifyMessage(detail.includes("not connected") ? "Connect one Spotify Premium account to make this phone the speaker." : detail);
      }
    }

    void initializeSpotify();
    return () => {
      active = false;
      spotifyPlayerRef.current?.disconnect();
      spotifyPlayerRef.current = null;
      if (spotifyEndTimerRef.current) window.clearTimeout(spotifyEndTimerRef.current);
      window.onSpotifyWebPlaybackSDKReady = undefined;
    };
  }, [code, getSpotifyToken, hostKey, participantId, partyEnded, spotifyRoom]);

  const playSpotifyTrack = useCallback(async (trackId: string, activate = false) => {
    const player = spotifyPlayerRef.current;
    if (!player || !spotifyDeviceId) throw new Error("Spotify speaker is still getting ready.");
    if (activate) await player.activateElement();
    const accessToken = await getSpotifyToken();
    const play = () => fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });
    let response = await play();
    if (response.status === 404) {
      await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ device_ids: [spotifyDeviceId], play: false }),
      });
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      response = await play();
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(data?.error?.message ?? `Spotify could not start playback (${response.status}).`);
    }
    lastStartedTrackRef.current = `spotify:track:${trackId}`;
    advancingTrackRef.current = false;
    setSpeakerArmed(true);
    setSpotifyMessage("🔊 Full track is playing here. HackMusic will start every next song automatically.");
  }, [getSpotifyToken, spotifyDeviceId]);

  const playYouTubeVideo = useCallback((videoId: string) => {
    playYouTube(videoId);
    lastStartedTrackRef.current = `youtube:video:${videoId}`;
    advancingTrackRef.current = false;
    setSpeakerArmed(true);
    setYoutubeMessage("🎬 Video is playing here. HackMusic will start every next song automatically.");
  }, [playYouTube]);

  async function startHostSpeaker() {
    if (speakerStarting || !currentTrackId) return;
    setSpeakerStarting(true);
    void requestScreenWakeLock();
    try {
      if (currentSource === "youtube") {
        if (!currentYouTubeId) throw new Error("This queue item has no YouTube video ID.");
        setYoutubeMessage("🎬 Starting the video on this device…");
        spotifyPlayerRef.current?.pause().catch(() => undefined);
        playYouTubeVideo(currentYouTubeId);
      } else if (currentSpotifyId) {
        setSpotifyMessage("🔊 Starting this browser as the Spotify speaker…");
        stopYouTube();
        await playSpotifyTrack(currentSpotifyId, true);
      }
    } catch (reason) {
      const fallback = currentSource === "youtube" ? "Could not start the video. Tap once more to retry." : "Could not start Spotify. Tap once more to retry.";
      const detail = reason instanceof Error ? reason.message : fallback;
      if (currentSource === "youtube") setYoutubeMessage(detail); else setSpotifyMessage(detail);
    } finally {
      setSpeakerStarting(false);
    }
  }

  useEffect(() => {
    const previousTrackId = previousPartyTrackRef.current;
    previousPartyTrackRef.current = currentTrackId;
    if (previousTrackId !== currentTrackId) advancingTrackRef.current = false;
    if (!previousTrackId || previousTrackId === currentTrackId || !hostKey || !participantId) return;
    const snapshot = lastPlaybackSnapshotRef.current;
    if (!snapshot || snapshot.trackId !== previousTrackId || snapshot.duration <= 0) return;
    const playedPosition = snapshot.paused
      ? snapshot.position
      : Math.min(snapshot.duration, snapshot.position + Math.max(0, Date.now() - snapshot.receivedAt));
    const skipPercent = Math.max(0, Math.min(100, Math.round((playedPosition / snapshot.duration) * 100)));
    void fetch("/api/party", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skipProgress", code, participantId, pin: hostKey, trackId: previousTrackId, skipPercent }),
    }).then(async (response) => {
      const data = await response.json();
      if (response.ok) setParty(data.party);
    }).catch(() => undefined);
  }, [code, currentTrackId, hostKey, participantId]);

  useEffect(() => {
    if (!speakerArmed) return;
    if (party?.status === "ended") {
      lastStartedTrackRef.current = "";
      void spotifyPlayerRef.current?.pause().catch(() => undefined);
      stopYouTube();
      return;
    }
    if (!currentTrackId) {
      lastStartedTrackRef.current = "";
      stopYouTube();
      return;
    }
    if (lastStartedTrackRef.current === currentTrackId) return;
    if (currentSource === "youtube" && currentYouTubeId) {
      if (youtubeStatus !== "ready") return;
      let cancelled = false;
      const startVideo = async () => {
        await spotifyPlayerRef.current?.pause().catch(() => undefined);
        if (cancelled) return;
        try {
          playYouTubeVideo(currentYouTubeId);
        } catch (reason) {
          setYoutubeMessage(reason instanceof Error ? reason.message : "Could not start the next video. Tap Start speaker.");
        }
      };
      void startVideo();
      return () => { cancelled = true; };
    }
    if (currentSource === "spotify" && currentSpotifyId && spotifyPlayerRef.current && spotifyStatus === "ready" && spotifyDeviceId) {
      stopYouTube();
      let cancelled = false;
      const wakeSpeaker = async () => {
        let finalMessage = "Spotify could not wake up for this song.";
        for (let attempt = 1; attempt <= 4 && !cancelled; attempt += 1) {
          try {
            await playSpotifyTrack(currentSpotifyId);
            return;
          } catch (reason) {
            finalMessage = reason instanceof Error ? reason.message : "Spotify could not wake up for this song.";
            if (attempt < 4 && !cancelled) {
              setSpotifyMessage(`🔄 A new song arrived. Waking the idle speaker automatically… attempt ${attempt + 1}/4`);
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 700));
            }
          }
        }
        if (!cancelled) setSpotifyMessage(`⚠️ ${finalMessage} HackMusic tried four times; tap Start speaker to recover.`);
      };
      void wakeSpeaker();
      return () => { cancelled = true; };
    }
    if (currentSource === "spotify") stopYouTube();
  }, [currentSource, currentSpotifyId, currentTrackId, currentYouTubeId, party?.status, playSpotifyTrack, playYouTubeVideo, speakerArmed, spotifyDeviceId, spotifyStatus, stopYouTube, youtubeStatus]);

  async function enableAudio() {
    setBusy(true);
    setMessage("🎛️ Building the reaction sound mixer…");
    try {
      await enableReactionAudio();
      setMessage("✅ Funny sounds are armed. You should hear a cheer and boo test now.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The funny sounds could not be armed. Reload and try once more.");
    } finally {
      setBusy(false);
    }
  }

  function startReadinessCheck() {
    setReadinessOpen(true);
    void runReadinessCheck({
      musicSource: partyMusicSource,
      spotifyStatus,
      youtubeStatus,
      enableReactionAudio,
      inspectReactionAudio,
      requestScreenWakeLock,
      wakeLockSupported,
      probeRoomData: async () => {
        try {
          const response = await fetch(`/api/party?code=${encodeURIComponent(code)}`, { headers: { "x-hackmusic-participant": participantId, "x-hackmusic-host-key": hostKey }, cache: "no-store" });
          return response.ok;
        } catch {
          return false;
        }
      },
    });
  }

  function blowAirhorn() {
    playEffect("airhorn", "host pressed the airhorn button");
    spawnBursts("up", ["📯", "🎉", "🔥", "🎊", "📯", "✨", "🙌"]);
    showAlert({ kind: "streak", title: "📯 AIRHORN", detail: "Host-approved hype." }, 1_600);
  }

  async function toggleRevealPickers() {
    if (!party || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revealPickers", code, participantId, pin: hostKey, revealPickers: !party.revealPickers }) });
      const data = await response.json() as { error?: string; party?: HostParty };
      if (!response.ok || !data.party) throw new Error(data.error ?? "The reveal setting did not save.");
      setParty(data.party);
      setMessage(data.party.revealPickers ? "🕵️ Pickers are revealed after every song. Drama mode on." : "🤫 Pickers stay secret until the party ends. Classic mode.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The reveal setting did not save.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTheme(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (themeBusy) return;
    setThemeBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "theme", code, participantId, pin: hostKey, theme: themeDraft }) });
      const data = await response.json() as { error?: string; party?: HostParty };
      if (!response.ok || !data.party) throw new Error(data.error ?? "The theme did not save.");
      setParty(data.party);
      setThemeDraft("");
      setMessage(data.party.theme ? `🎯 Round theme set: ${data.party.theme}. Guests see it now.` : "🎯 Theme cleared. Anything goes.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "The theme did not save.");
    } finally {
      setThemeBusy(false);
    }
  }

  async function shareRecap() {
    if (!party || recapBusy) return;
    setRecapBusy(true);
    try {
      const delivered = await shareRecapCard({
        title: party.title,
        code: party.code,
        musicSource: party.musicSource,
        people: [...party.people].sort((left, right) => right.score - left.score).map((person) => ({ name: person.name, avatar: person.initials, score: person.score })),
        awards: party.awards ?? [],
        songsPlayed: party.recap?.songsPlayed ?? party.songHistory.length,
        songsBooedOff: party.recap?.songsBooedOff ?? party.songHistory.filter((track) => track.skipReason === "boos").length,
        reactions: party.recap?.reactions ?? 0,
      });
      setMessage(delivered === "shared" ? "📸 Recap card shared." : "📸 Recap card saved to downloads.");
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setMessage(reason instanceof Error ? reason.message : "The recap card could not be created.");
    } finally {
      setRecapBusy(false);
    }
  }

  function disableAudio() {
    disableReactionAudio();
    setMessage("🔇 Funny sounds are off. Spotify keeps playing normally.");
  }

  async function copyInvite() {
    if (!joinPasscode) { setMessage("🔐 Set a room passcode before sharing this invitation."); return; }
    const invitation = `Join ${party?.title ?? "my HackMusic room"}\n${shareUrl}\nRoom: ${code}\nPasscode: ${joinPasscode}`;
    try { await navigator.clipboard.writeText(invitation); setMessage("📋 Invite URL + passcode copied!"); }
    catch { setMessage("Copy the URL shown below."); }
  }

  async function shareInvite() {
    if (!joinPasscode) { setMessage("🔐 Set a room passcode before sharing this invitation."); return; }
    if (navigator.share) {
      await navigator.share({ title: party?.title ?? "HackMusic", text: `Join HackMusic room ${code}\nPasscode: ${joinPasscode}`, url: shareUrl });
    } else {
      await copyInvite();
    }
  }

  async function replaceJoinPasscode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPasscode = replacementPasscode.trim().toUpperCase();
    setBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "passcode", code, participantId, pin: hostKey, passcode: nextPasscode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not update the room passcode.");
      window.localStorage.setItem(`hackmusic:${code}:joinPasscode`, nextPasscode);
      setJoinPasscode(nextPasscode);
      setReplacementPasscode("");
      setParty(data.party);
      setMessage("🔐 New room passcode armed. Share the new one with guests.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not update the room passcode."); }
    finally { setBusy(false); }
  }

  function rememberHostedRoom(nextParty: HostParty) {
    const storageKey = "hackmusic:hostedRooms";
    const now = new Date().toISOString();
    let rooms: Array<{ code: string; title: string; status: string; createdAt: string; lastOpenedAt: string }> = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
      if (Array.isArray(stored)) rooms = stored.filter((room): room is typeof rooms[number] => Boolean(room && typeof room === "object" && "code" in room && typeof room.code === "string"));
    } catch {
      // A damaged shortcut list should not block a host handoff.
    }
    const existing = rooms.find((room) => room.code === nextParty.code);
    const shortcut = { code: nextParty.code, title: nextParty.title, status: nextParty.status, createdAt: existing?.createdAt ?? now, lastOpenedAt: now };
    window.localStorage.setItem(storageKey, JSON.stringify([shortcut, ...rooms.filter((room) => room.code !== nextParty.code)].slice(0, 100)));
  }

  function openRename() {
    if (!party) return;
    setRenameTitle(party.title);
    setRenameOpen(true);
  }

  async function renameEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = renameTitle.trim();
    if (title.length < 3 || title.length > 60) {
      setMessage("✏️ Give the event a name between 3 and 60 characters.");
      return;
    }
    setRenameBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rename", code, participantId, pin: hostKey, title }) });
      const data = await response.json() as { error?: string; party?: HostParty };
      if (!response.ok || !data.party) throw new Error(data.error ?? "Could not rename the event.");
      setParty(data.party);
      rememberHostedRoom(data.party);
      setRenameOpen(false);
      setMessage(`✏️ Event renamed to “${data.party.title}”. Same chaos, fresher label.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not rename the event. The old name is still safe.");
    } finally {
      setRenameBusy(false);
    }
  }

  async function prepareHandoff(targetParticipantId: string) {
    setHandoffBusy(true);
    setHandoffInvite(null);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepareHostTransfer", code, participantId, pin: hostKey, targetParticipantId }) });
      const data = await response.json() as { error?: string; transfer?: HostTransfer };
      if (!response.ok || !data.transfer) throw new Error(data.error ?? "Could not prepare the handoff link.");
      const url = `${window.location.origin}/e/${code}/host#handoff=${encodeURIComponent(data.transfer.token)}`;
      setHandoffInvite({ ...data.transfer, url });
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not prepare the handoff link.");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function copyHandoff() {
    if (!handoffInvite) return;
    const handoff = `HackMusic host handoff for room ${code}\n${handoffInvite.url}\nOne use · expires in 10 minutes`;
    try {
      await navigator.clipboard.writeText(handoff);
      setMessage(`🎚️ One-use host link copied for ${handoffInvite.targetName}.`);
    } catch {
      setMessage("Copy the one-use link shown in the handoff panel.");
    }
  }

  async function shareHandoff() {
    if (!handoffInvite) return;
    if (!navigator.share) { await copyHandoff(); return; }
    try {
      await navigator.share({ title: `Host HackMusic room ${code}`, text: `You have been chosen to hold the aux cable. One use; 10 minutes.`, url: handoffInvite.url });
    } catch (reason) {
      if (!(reason instanceof DOMException) || reason.name !== "AbortError") setMessage("Sharing took a small dramatic pause. Copy the link instead.");
    }
  }

  async function cancelHandoff() {
    setHandoffBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancelHostTransfer", code, participantId, pin: hostKey }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not cancel the handoff.");
      setHandoffInvite(null);
      setHandoffOpen(false);
      setMessage("🧯 Host handoff cancelled. You still control the chaos.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not cancel the handoff.");
    } finally {
      setHandoffBusy(false);
    }
  }

  async function claimHandoff() {
    if (!participantId || !handoffToken) return;
    setHandoffClaimBusy(true);
    setHandoffClaimError("");
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "claimHost", code, participantId, transferToken: handoffToken }) });
      const data = await response.json() as { error?: string; hostKey?: string; party?: HostParty };
      if (!response.ok || !data.hostKey || !data.party) throw new Error(data.error ?? "Could not accept the host controls.");
      window.localStorage.setItem(`hackmusic:${code}:host`, data.hostKey);
      window.sessionStorage.removeItem(`hackmusic:${code}:handoff`);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      rememberHostedRoom(data.party);
      setHostKey(data.hostKey);
      setParty(data.party);
      setHandoffToken("");
      setError("");
      setMessage("🎛️ You are the host now. Power remains a terrible idea.");
    } catch (reason) {
      setHandoffClaimError(reason instanceof Error ? reason.message : "Could not accept the host controls.");
    } finally {
      setHandoffClaimBusy(false);
    }
  }

  function connectSpotify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clientId = spotifyClientId.trim();
    if (!/^[A-Za-z0-9]{20,64}$/.test(clientId)) {
      setSpotifyMessage("Paste the public Client ID from your Spotify developer app.");
      return;
    }
    window.localStorage.setItem("hackmusic:spotify:clientId", clientId);
    window.location.assign(`/api/spotify/login?clientId=${encodeURIComponent(clientId)}&roomCode=${encodeURIComponent(code)}`);
  }

  async function copySpotifyCallback() {
    const callbackUrl = `${window.location.origin}/api/spotify/callback`;
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setSpotifyMessage("📋 Spotify callback URL copied!");
    } catch {
      setSpotifyMessage("Copy the callback URL shown below exactly.");
    }
  }

  async function disconnectSpotify() {
    spotifyPlayerRef.current?.disconnect();
    spotifyPlayerRef.current = null;
    await fetch("/api/spotify/disconnect", { method: "POST" });
    if (activeSourceRef.current === "spotify") lastStartedTrackRef.current = "";
    lastPlaybackStateRef.current = null;
    spotifyStateReceivedAtRef.current = 0;
    if (activeSourceRef.current === "spotify") setPlaybackProgress({ position: 0, duration: 0, paused: true, trackUri: "" });
    if (activeSourceRef.current !== "youtube") setSpeakerArmed(false);
    setSpotifyDeviceId("");
    setSpotifyStatus("disconnected");
    setSpotifyMessage("👋 Spotify disconnected from this browser.");
  }

  async function control(action: "start" | "skip" | "advance" | "end") {
    setBusy(true);
    logHostEvent(`host pressed ${action}`, `current ${currentTrackIdRef.current || "none"}`);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, code, participantId, pin: hostKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Host action failed.");
      setParty(data.party);
      if (action === "end") void releaseScreenWakeLock(false);
      setMessage(action === "start" ? data.party.currentTrack ? "🚀 Party started! The first secret song is ready." : "🚀 Party started! Add a song to wake up the speaker." : action === "skip" ? "⏭️ Skipped! Next secret song!" : action === "advance" ? "🎵 Song finished. Next one!" : "🏁 Party ended. Scores are final!");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Host action failed."); }
    finally { setBusy(false); }
  }

  async function changeQueueMode(queueMode: HostParty["queueMode"]) {
    if (busy || queueMode === party?.queueMode) return;
    setBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "queueMode", code, participantId, pin: hostKey, queueMode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not change the queue shuffle.");
      setParty(data.party);
      const selected = queueModes.find((mode) => mode.id === queueMode);
      setMessage(`${selected?.icon ?? "🎛️"} Next-song mode: ${selected?.title ?? queueMode}.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not change the queue shuffle.");
    } finally {
      setBusy(false);
    }
  }

  if (handoffToken && !party) return <main className="host-claim-shell"><section className="host-claim-card"><span className="brand-mark">HM</span><p className="eyebrow">🎚️ CONTROLLED MUTINY · ROOM {code}</p><h1>The aux cable chose you.</h1><p className="host-claim-intro">Accept this one-use handoff and this browser becomes the only host. The previous host is politely demoted to audience.</p><div className="host-claim-truth"><strong>Spotify cannot teleport. Rude, honestly.</strong><span>After accepting, start the speaker here. YouTube rooms need no setup; Spotify rooms need Spotify Premium connected on this device. The previous device will disconnect from host duty.</span></div>{participantId ? <button type="button" onClick={() => void claimHandoff()} disabled={handoffClaimBusy}>{handoffClaimBusy ? "🎛️ Moving the giant imaginary switch…" : "🎛️ Accept host controls →"}</button> : <><div className="host-claim-join"><strong>First, enter the party on this browser.</strong><span>We saved the handoff in this tab. Join normally, and HackMusic will bring you straight back.</span></div><a className="host-claim-link" href={`/e/${code}${typeof window !== "undefined" && isDevelopmentHost(window.location.hostname) && personaFromSearch(window.location.search) ? `?persona=${encodeURIComponent(personaFromSearch(window.location.search))}` : ""}`}>🥳 Join room {code} first →</a></>}{handoffClaimError && <p className="host-claim-error" role="alert">⚠️ {handoffClaimError}</p>}<small>🔐 Targeted human · one use · expires after 10 minutes</small></section></main>;
  if (error && !party) {
    const moved = error.includes("aux cable moved");
    return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">{moved ? "🎚️ HOST ROLE MOVED" : "HOST KEY REQUIRED"}</p><h1>{moved ? "Audience era unlocked." : error}</h1>{moved && <p>{error}</p>}<a href={`/e/${code}`}>Open the participant room →</a><a href="/">Create a new room →</a></main>;
  }
  if (syncProblem && !party) return <main className="missing-room host-reconnect-screen"><span className="brand-mark">HM</span><p className="eyebrow">📡 RECONNECTING THE DJ BOOTH</p><h1>Connection hiccup.</h1><p>{syncProblem}</p><button type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "Trying again…" : "↻ Try room data again"}</button><a href={`/e/${code}`} target="_blank" rel="noreferrer">Open participant view safely ↗</a></main>;
  if (!party) return <main className="loading-room"><span className="brand-mark">HM</span><p>Warming up room {code}…</p></main>;

  const cheers = party.reactions.filter((reaction) => reaction.tone === "up").length;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;
  const progressMatchesCurrent = Boolean(currentTrackId && playbackProgress.trackUri === currentTrackId);
  const progressDuration = progressMatchesCurrent && playbackProgress.duration > 0 ? playbackProgress.duration : trackDurationMilliseconds(party.currentTrack?.duration ?? "");
  const progressPosition = progressMatchesCurrent ? Math.min(playbackProgress.position, progressDuration || playbackProgress.position) : 0;
  const progressPercent = progressDuration > 0 ? Math.min(100, Math.max(0, progressPosition / progressDuration * 100)) : 0;
  const progressState = speakerStarting ? "STARTING" : speakerArmed && progressMatchesCurrent ? playbackProgress.paused ? "PAUSED" : "PLAYING" : speakerArmed ? "LOADING" : "READY";
  const playbackProgressBar = <div className={`host-playback-progress ${progressState.toLowerCase()}`}><div><strong>{formatPlaybackTime(progressPosition)}</strong><span>{progressState === "PLAYING" ? "⚡ PLAYING" : progressState === "PAUSED" ? "⏸ PAUSED" : progressState === "STARTING" ? "🔊 STARTING" : progressState === "LOADING" ? "⏳ LOADING TRACK" : "👆 READY TO START"}</span><strong>{formatPlaybackTime(progressDuration)}</strong></div><div className="host-progress-track" role="progressbar" aria-label={`Playback: ${formatPlaybackTime(progressPosition)} of ${formatPlaybackTime(progressDuration)}`} aria-valuemin={0} aria-valuemax={Math.max(1, progressDuration)} aria-valuenow={Math.round(progressPosition)}><span style={{ width: `${progressPercent}%` }} /></div></div>;
  const spotifyCallbackUrl = shareUrl ? new URL("/api/spotify/callback", shareUrl).toString() : "";
  const readinessPassed = Boolean(readinessResults && !readinessResults.some((result) => result.status === "fail"));
  const firstSongReady = party.status === "live" && Boolean(party.currentTrack);
  const speakerPlaying = speakerArmed && progressMatchesCurrent && !playbackProgress.paused;
  const setupSteps: Array<{ id: "spotify" | "check" | "song" | "speaker" | "keep"; title: string; copy: string; done: boolean; actionLabel?: string; disabled?: boolean }> = [
    ...(spotifyRoom ? [{
      id: "spotify",
      title: "Connect Spotify Premium",
      copy: spotifyStatus === "ready" ? "Connected on this device. It cannot move to another one." : "Paste your Spotify Client ID in the Spotify card below and sign in.",
      done: spotifyStatus === "ready",
      actionLabel: "Open the Spotify card ↓",
    } as const] : []),
    {
      id: "check",
      title: "Run the readiness check",
      copy: readinessPassed ? "Sounds armed and wake lock requested on this page. Do not reload it." : "One tap arms the funny sounds, requests the wake lock, and tests playback.",
      done: readinessPassed,
      actionLabel: readinessRunning ? "Checking…" : readinessPassed ? "🧪 Run again (optional)" : "🧪 Run readiness check",
      disabled: readinessRunning,
    },
    {
      id: "song",
      title: party.status === "lobby" ? "Start the party" : "Wait for the first song",
      copy: party.status === "lobby"
        ? `${party.queueCount} secret ${party.queueCount === 1 ? "song is" : "songs are"} waiting. Share the code, then start when everyone is in.`
        : firstSongReady ? "The first song is on deck." : "Share the room code and passcode. The first submitted song appears here automatically.",
      done: firstSongReady,
      actionLabel: party.status === "lobby" ? (busy ? "Starting…" : "🚀 Start the party") : "📋 Copy invite",
      disabled: party.status === "lobby" && busy,
    },
    {
      id: "speaker",
      title: "Start the speaker",
      copy: youtubeRoom ? "Tap once. If the video stays still, tap the video itself once. Later videos start automatically." : "Tap once. Later songs start automatically.",
      done: speakerArmed,
      actionLabel: speakerStarting ? "Starting…" : speakerArmed ? "🔁 Restart current song" : youtubeRoom ? "▶️ Start speaker" : "🔊 Start speaker",
      disabled: !firstSongReady || speakerStarting || (youtubeRoom ? youtubeStatus !== "ready" : spotifyStatus !== "ready"),
    },
    {
      id: "keep",
      title: "Keep this tab open",
      copy: speakerPlaying ? "Music is playing. No reload, no app switching, no Split View until the party ends." : "Once music plays: no reload, no app switching, no Split View until the party ends.",
      done: speakerPlaying,
    },
  ];
  const currentStepIndex = setupSteps.findIndex((step) => !step.done);
  const setupComplete = currentStepIndex === -1;
  const runSetupStep = (id: typeof setupSteps[number]["id"]) => {
    if (id === "spotify") document.getElementById("spotify-connect")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (id === "check") startReadinessCheck();
    else if (id === "song") void (party.status === "lobby" ? control("start") : copyInvite());
    else if (id === "speaker") void startHostSpeaker();
  };
  return <main className="host-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></a><a className="participant-link" href={`/e/${code}`} target="_blank" rel="noreferrer">{party.status === "ended" ? "🏆 View final party page ↗" : "🎉 Open participant page safely ↗"}</a></header>
    <div className="host-heading"><div><p className="eyebrow">🎛️ HOST CONTROL · ROOM {party.code}</p><h1>{party.title}</h1>{party.theme && <span className="host-theme-pill" dir="auto">🎯 {party.theme}</span>}{party.status !== "ended" && <button className="host-rename-trigger" type="button" onClick={openRename}>✏️ Rename event</button>}</div><div className="host-heading-actions"><span className={`host-status ${party.status}`}>{party.status === "ended" ? "🏁 PARTY ENDED" : party.status === "lobby" ? "🌙 LOBBY OPEN" : "⚡ LIVE"}</span>{party.status !== "ended" && <><button className="host-soft-refresh" type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "↻ SYNCING…" : "↻ REFRESH ROOM DATA"}</button><small>Safe refresh · music keeps playing</small></>}</div></div>

    {(syncProblem || error) && <section className={`host-sync-banner ${error ? "access" : "offline"}`} role="status"><div><strong>{error ? "🔐 Host access needs attention" : "📡 Room data is reconnecting"}</strong><span>{error || syncProblem}</span><small>{error ? "Spotify may continue, but host controls need the creator browser." : "Do not reload. Automatic retries are running and Spotify is untouched."}</small></div><button type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "Trying…" : "Try now →"}</button></section>}

    {party.status === "ended" ? <section className="host-ended-summary"><div><p className="eyebrow">🏁 THE AUX CABLE HAS BEEN RETIRED</p><h2>That&apos;s a wrap.</h2><p>Scores are frozen, voting is closed, and the speaker can finally process what happened.</p></div><div className="host-ended-summary-stats"><span><strong>{party.people.length}</strong> humans</span><span><strong>{party.queuedTracks.length}</strong> unplayed</span></div><div className="host-ended-summary-actions"><button type="button" onClick={() => void shareRecap()} disabled={recapBusy}>{recapBusy ? "📸 Drawing…" : "📸 Share the recap card"}</button><a href={`/e/${code}`}>🏆 View final party page →</a><a href="/">🎉 Create another room</a></div></section> : <section className="share-room-card"><div className="share-code"><span>📱 ROOM CODE</span><strong>{party.code}</strong>{joinPasscode ? <div className="share-passcode"><span>🔐 JOIN PASSCODE</span><strong>{joinPasscode}</strong><small>Not included in the URL or QR code. Copy/Share sends both.</small></div> : <div className="share-passcode-warning"><strong>{party.requiresPasscode ? "🔐 Passcode hidden on this browser" : "🚨 Legacy room: no passcode yet"}</strong><span>{party.requiresPasscode ? "Set a new one below if the original is lost." : "Lock it before sharing the room."}</span></div>}<details className="replace-passcode"><summary>{joinPasscode ? "Rotate room passcode" : "Set a room passcode"}</summary><form onSubmit={replaceJoinPasscode}><label htmlFor="replacement-passcode">NEW PASSCODE</label><input id="replacement-passcode" value={replacementPasscode} onChange={(event) => setReplacementPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="new-password" placeholder="e.g. VIBE42" required /><button type="submit" disabled={busy}>🔐 Save new passcode</button></form></details><p>{shareUrl}</p><div><button type="button" onClick={() => void copyInvite()}>📋 Copy invite</button><button type="button" onClick={() => void shareInvite()}>🚀 Share</button></div></div>{qrUrl && <Image unoptimized src={qrUrl} width={180} height={180} alt={`QR code to join room ${party.code}`} />}</section>}
        {party.status === "ended" && party.awards && party.awards.length > 0 && <section className="awards-card host-awards-card"><div className="card-title-row"><h2>🎖️ PARTY AWARDS</h2><span>{party.awards.length} {party.awards.length === 1 ? "TROPHY" : "TROPHIES"}</span></div><div className="awards-grid">{party.awards.map((entry) => <article className="award" key={entry.id}><span className="award-emoji" aria-hidden="true">{entry.emoji}</span><div><strong>{entry.title}</strong><p><span className={`avatar ${entry.winnerColor}`}>{entry.winnerAvatar}</span> <b>{entry.winnerName}</b></p><small>{entry.detail}</small></div></article>)}</div></section>}

    {party.status !== "ended" && (setupComplete && !setupExpanded
      ? <section className="host-setup-card complete"><div><p className="eyebrow">🧭 SETUP ORDER</p><strong>✅ Setup complete. Music is playing on this device.</strong><span>Keep this tab open. Reactions and the next songs are automatic.</span></div><button type="button" onClick={() => setSetupExpanded(true)}>Show steps</button></section>
      : <section className="host-setup-card" aria-labelledby="host-setup-title"><div className="host-setup-heading"><div><p className="eyebrow">🧭 SETUP ORDER · TOP TO BOTTOM</p><h2 id="host-setup-title">{setupComplete ? "All set." : `Step ${currentStepIndex + 1} of ${setupSteps.length}: ${setupSteps[currentStepIndex].title}`}</h2></div>{setupComplete && <button className="host-setup-hide" type="button" onClick={() => setSetupExpanded(false)}>Hide</button>}</div><ol className="host-setup-steps">{setupSteps.map((step, index) => { const state = step.done ? "done" : index === currentStepIndex ? "current" : "locked"; return <li className={`setup-${state}`} key={step.id}><span className="setup-index" aria-hidden="true">{step.done ? "✓" : index + 1}</span><div className="setup-copy"><strong>{step.title}</strong><p>{step.copy}</p></div>{step.actionLabel && <button type="button" onClick={() => runSetupStep(step.id)} disabled={state === "locked" || step.disabled} aria-label={`${step.actionLabel} (step ${index + 1})`}>{state === "locked" ? "🔒 Later" : step.actionLabel}</button>}</li>; })}</ol><p className="host-setup-note">🧠 Only the current step&apos;s button is active. Reloading this page undoes steps 1–{spotifyRoom ? 2 : 1}: run the readiness check again if that happens.</p></section>)}
    {party.status === "lobby" && <section className="host-lobby-card"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY IS OPEN</p><h2>Let the queue marinate.</h2><p>Expected start: <strong>{formatPartyStart(party.scheduledFor, "Whenever you say go")}</strong></p><small>Guests can join and add songs now. Playback and reactions stay locked until you start.</small></div><div className="host-lobby-action"><span><strong>{party.people.length}</strong> humans · <strong>{party.queueCount}</strong> secret songs</span><button type="button" disabled={busy} onClick={() => void control("start")}>{busy ? "🚀 Starting…" : "🚀 Start the party now →"}</button><small>You control the exact start time. This cannot return to lobby mode.</small></div></section>}

    {party.status !== "ended" && youtubeRoom && <section className="spotify-connect-card youtube-room-card"><div className="spotify-connect-heading"><div><p className="eyebrow">▶️ FULL-VIDEO SPEAKER · YOUTUBE ROOM</p><h2>YouTube</h2></div><span>{youtubeStatus === "ready" ? "✅ PLAYER READY" : youtubeStatus === "error" ? "⚠️ PLAYER FAILED" : "🔎 LOADING…"}</span></div><p className="speaker-scope-note">🔒 This room was created for YouTube links only. Videos play right here on the host page. Keep this tab open and its volume up.</p><div className="spotify-setup-grid youtube-setup-grid"><ol>
        <li><span>1</span><p>Guests paste <strong>YouTube links</strong> from the app or browser. Full links, youtu.be links, and Shorts all work. Playlists are shown the door.</p></li>
        <li><span>2</span><p>When the first video arrives, tap <strong>Start speaker</strong> in the card below. The video plays right here, so connect this {hostDeviceName} to the real speaker or a TV.</p></li>
        <li><span>3</span><p>On an iPhone or iPad the browser wants one tap <strong>on the video itself</strong> the first time. After that, every next video starts automatically.</p></li>
      </ol><div className="youtube-setup-aside"><strong>▶️ No account. No developer dashboard. No client ID.</strong><span>The only setup is a room passcode and a working volume knob. Unplayable or private videos are skipped automatically with a note.</span></div></div></section>}
    {party.status !== "ended" && spotifyRoom && <section id="spotify-connect" className={`spotify-connect-card spotify-${spotifyStatus}`}>
      <div className="spotify-connect-heading">
        <div><p className="eyebrow">🔊 FULL-TRACK SPEAKER · SPOTIFY ROOM</p><h2>Spotify Premium</h2></div>
        <span>{spotifyStatus === "ready" ? "✅ CONNECTED" : spotifyStatus === "loading" || spotifyStatus === "checking" ? "🔎 CHECKING…" : "🛠️ SETUP NEEDED"}</span>
      </div>
      <p className="speaker-scope-note">🔒 This room was created for Spotify links only. Connect one Spotify Premium account here to become the speaker.</p>
      {spotifyStatus === "ready" ? <div className="spotify-connected-row"><div><strong>🎉 This browser is ready to become the speaker.</strong><p>📱 Connect the host phone to your real speaker, then start playback once below.</p></div><button type="button" onClick={() => void disconnectSpotify()}>👋 Disconnect</button></div> : spotifyStatus === "checking" || spotifyStatus === "loading" ? <p className="spotify-loading">🔎 Opening the Spotify Web Playback SDK…</p> : <div className="spotify-setup-grid">
        <ol>
          <li><span>1</span><p>Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard ↗</a>. Select Web API and Web Playback SDK if asked.</p></li>
          <li><span>2</span><div><p>Add this exact redirect URI in the app settings:</p><code>{spotifyCallbackUrl}</code><button type="button" onClick={() => void copySpotifyCallback()}>Copy callback URL</button></div></li>
          <li><span>3</span><p>Paste the app&apos;s public <strong>Client ID</strong> here. Do not paste its client secret.</p></li>
        </ol>
        <form className="spotify-connect-form" onSubmit={connectSpotify}>
          <label htmlFor="spotify-client-id">SPOTIFY CLIENT ID</label>
          <input id="spotify-client-id" value={spotifyClientId} onChange={(event) => setSpotifyClientId(event.target.value)} placeholder="Paste the public Client ID" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <button type="submit">🟢 Connect Spotify Premium →</button>
        </form>
      </div>}
      {spotifyMessage && <p className="spotify-message" role="status">{spotifyMessage}</p>}
    </section>}

    <div className="host-grid"><section className="host-now-card"><div className="section-kicker"><span>{party.status === "ended" ? "📼 LAST SONG" : party.status === "lobby" ? "🌙 SPEAKER SLEEPING" : "🔊 ON THE SPEAKER"}</span><span>{party.status === "ended" ? `📦 ${party.queueCount} UNPLAYED` : `🤫 ${party.queueCount} WAITING`}</span></div>{party.status !== "ended" && youtubeRoom && <div className={`youtube-stage ${currentYouTubeId && party.currentTrack ? "active" : "idle"}`} ref={attachYouTubeStage} aria-label="YouTube video player" />}{party.currentTrack ? <><div className="host-track"><div className={`host-art ${party.currentTrack.color}${currentYouTubeId ? " host-art-video" : ""}`}>{currentYouTubeId ? <Image unoptimized src={youtubeThumbnailUrl(currentYouTubeId)} width={120} height={120} alt="" /> : "🎵"}</div><div><h2>{party.currentTrack.title}</h2><p>{party.currentTrack.artist}{party.currentTrack.duration ? ` · ${party.currentTrack.duration}` : ""}</p></div></div>{party.status !== "ended" && (currentSource === "youtube" && currentYouTubeId ? <div className={`youtube-host-player youtube-${youtubeStatus}`}><div><strong>▶️ YOUTUBE VIDEO SPEAKER</strong><span>{youtubeStatus === "ready" ? "🎬 Plays right here · no account needed" : youtubeStatus === "error" ? "⚠️ YouTube player failed to load. Reload this page." : "⏳ Loading the YouTube player…"}</span></div><button type="button" disabled={speakerStarting || youtubeStatus !== "ready" || party.status !== "live"} onClick={() => void startHostSpeaker()}>{speakerStarting ? "🎬 Starting video…" : speakerArmed ? "🔁 Play this video again →" : "▶️ Start speaker →"}</button>{playbackProgressBar}{youtubeNeedsTap && <p className="youtube-tap-hint" role="status">👆 This {hostDeviceName} wants one tap on the video itself to start sound. After that, HackMusic starts every next song automatically.</p>}{youtubeMessage && <p className="youtube-message" role="status">{youtubeMessage}</p>}<small>👉 Starts the video only. Funny sounds stay off unless you enable them separately.</small></div> : currentSpotifyId ? <div className={`spotify-host-player spotify-${spotifyStatus}`}><div><strong>🟢 SPOTIFY PREMIUM SPEAKER</strong><span>{spotifyStatus === "ready" ? "🎶 Full song · no preview limit" : "👆 Connect Spotify above first"}</span></div><button type="button" disabled={speakerStarting || spotifyStatus !== "ready" || party.status !== "live"} onClick={() => void startHostSpeaker()}>{speakerStarting ? "🔊 Starting speaker…" : speakerArmed ? "🔁 Play this track again →" : "🔊 Start speaker →"}</button>{playbackProgressBar}<small>👉 Starts Spotify only. Funny sounds stay off unless you enable them separately.</small></div> : <div className="unplayable-track"><strong>⚠️ This queue item has no playable Spotify or YouTube ID.</strong><span>Skip this legacy item once. Every newly added song is now validated before it enters the queue.</span></div>)}<div className="host-reaction-counts"><div className="host-cheers"><strong>{cheers}</strong><span>🙌 CHEERS</span></div><div className="host-boos"><strong>{boos}</strong><span>👻 BOOS</span></div></div></> : <div className="host-empty"><strong>{party.status === "ended" ? "🏁 The speaker is off." : party.status === "lobby" ? "🌙 Playback is locked." : speakerArmed ? "🌙 Speaker armed. Enjoy the dramatic silence." : "🦗 No song yet."}</strong><p>{party.status === "ended" ? "The final scoreboard and any unplayed songs are saved below." : party.status === "lobby" ? `🤫 ${party.queueCount} secret ${party.queueCount === 1 ? "song is" : "songs are"} waiting for your launch.` : speakerArmed ? "🎵 Add another song whenever you like. It will wake the speaker and start automatically." : "🎵 Open the participant page and add the first one."}</p></div>}</section>
      {party.status === "ended" ? <section className="host-controls-card host-controls-retired"><div className="card-title-row"><h2>🧊 CONTROLS FROZEN</h2><span>FINAL</span></div><div className="host-retired-mark">🏁</div><h3>The buttons have left the building.</h3><p>Playback, reactions, invitations, passcodes, queue rules, funny sounds, and screen wake lock are finished for this room.</p><a href="/">Start fresh with a new party →</a></section> : <section className="host-controls-card"><div className="card-title-row"><h2>🎛️ CONTROLS</h2><span>📱 HOST DEVICE</span></div><button className="host-readiness" type="button" onClick={startReadinessCheck} disabled={readinessRunning}>{readinessRunning ? "🧪 Checking this device…" : readinessResults ? "🧪 Run readiness check again" : `🧪 Run ${hostDeviceName} readiness check`}</button><button className={`host-audio ${audioEnabled ? "armed" : ""}`} type="button" aria-pressed={audioEnabled} onClick={audioEnabled ? disableAudio : enableAudio}>{audioEnabled ? "🔇 Disable funny sounds" : "🎉 Enable & test funny sounds"}</button><button className={`host-wake-lock ${wakeLockActive ? "armed" : ""}`} type="button" aria-pressed={wakeLockActive} disabled={wakeLockSupported === false} onClick={() => wakeLockActive ? void releaseScreenWakeLock() : void requestScreenWakeLock()}>{wakeLockActive ? "🔒 Screen staying awake · tap to release" : wakeLockSupported === false ? "⚠️ Screen wake lock unavailable" : "☀️ Keep this screen awake"}</button><button className="host-airhorn" type="button" disabled={!audioEnabled} onClick={blowAirhorn} title={audioEnabled ? "Blast the airhorn" : "Enable funny sounds first"}>📯 Airhorn</button><form className="host-theme-form" onSubmit={saveTheme}><label htmlFor="round-theme">🎯 ROUND THEME</label><div><input id="round-theme" value={themeDraft} onChange={(event) => setThemeDraft(event.target.value)} maxLength={MAX_THEME_LENGTH} placeholder={party.theme ? `Current: ${party.theme}` : "e.g. Guilty pleasures, Before 2000"} /><button type="submit" disabled={themeBusy}>{themeBusy ? "…" : themeDraft.trim() ? "Set" : party.theme ? "Clear" : "Set"}</button></div><small>Guests see it on their phone and in the add-song sheet.</small></form><button className={`host-reveal-toggle ${party.revealPickers ? "armed" : ""}`} type="button" aria-pressed={party.revealPickers} disabled={busy} onClick={() => void toggleRevealPickers()}>{party.revealPickers ? "🕵️ Pickers revealed after each song · tap to hide" : "🤫 Pickers secret until the end · tap to reveal per song"}</button><button className="host-skip" type="button" disabled={busy || !party.currentTrack} onClick={() => void control("skip")}>⏭️ Skip to next song →</button><button className="host-end" type="button" disabled={busy} onClick={() => setEndConfirmOpen(true)}>🏁 End party & freeze scores</button><p className={`host-wake-status ${wakeLockActive ? "active" : ""}`}>{wakeLockStatus}</p><details className="host-wake-guide"><summary>🛟 Screen-awake help · detected {hostDeviceName}</summary><ul><li className={hostDevice === "ios" ? "current" : ""}><strong>🍎 iPhone / iPad</strong><span>Try the button first. If unavailable, use Settings → Display &amp; Brightness → Auto-Lock and choose Never or the longest available time.</span></li><li className={hostDevice === "android" ? "current" : ""}><strong>🤖 Android</strong><span>Try the button first. Otherwise increase Display → Screen timeout, or enable Developer options → Stay awake while charging.</span></li><li className={hostDevice === "computer" ? "current" : ""}><strong>💻 Computer</strong><span>Keep this tab visible. If needed, temporarily disable display sleep in the computer’s power or display settings.</span></li></ul></details><p className="host-hint">🔊 Reaction sounds play only from this host device. Keep this page open and its volume up.</p><details className="host-rare-tools"><summary>🧰 Rare host moves</summary><div><p>Need a new device or a less exhausted DJ? Initiate one highly regulated coup.</p><button type="button" onClick={() => { setHandoffInvite(null); setHandoffOpen(true); }}>🎚️ Pass the aux cable →</button><small>One-use link · chosen human only · 10 minutes</small></div></details></section>}
    </div>
    <section className="host-queue-card"><div className="card-title-row"><h2>{party.status === "ended" ? "📦 UNPLAYED AT CLOSING" : "🎶 WAITING IN THE QUEUE"}</h2><span>{party.status === "ended" ? "ARCHIVE" : "🤫"} {party.queuedTracks.length} {party.queuedTracks.length === 1 ? "SONG" : "SONGS"}</span></div>{party.status !== "ended" && <fieldset className="queue-mode-picker"><legend>HOW SHOULD THE NEXT SONG BE PICKED?</legend><div>{queueModes.map((mode) => <button className={party.queueMode === mode.id ? "active" : ""} type="button" aria-pressed={party.queueMode === mode.id} disabled={busy} onClick={() => void changeQueueMode(mode.id)} key={mode.id}><span className="queue-mode-icon">{mode.icon}</span><span className="queue-mode-copy"><strong>{mode.title}</strong><small>{mode.copy}</small></span><span className="queue-mode-state">{party.queueMode === mode.id ? "✓ ACTIVE" : "SELECT"}</span></button>)}</div></fieldset>}{party.queuedTracks.length ? <><p className="queue-order-note">{party.status === "ended" ? "📼 These songs were still waiting when the final bell rang." : party.queueMode === "ordered" ? "📍 The numbered list below is the exact play order." : party.queueMode === "random" ? "🎲 These songs are the chaos pool. The next one is chosen only when it’s time." : "⚖️ These songs are the fair-play pool. HackMusic balances people first, then rolls the dice."}</p><ol className="host-queue-list">{party.queuedTracks.map((track, index) => <li key={track.queueId}><span className="queue-position">{party.status === "ended" ? String(index + 1).padStart(2, "0") : party.queueMode === "ordered" ? String(index + 1).padStart(2, "0") : party.queueMode === "random" ? "🎲" : "⚖️"}</span><span className={`queue-art ${track.color}`}>{trackSource(track.id) === "youtube" ? "▶️" : "🎵"}</span><div className="queue-track-copy"><strong dir="auto">{track.title}</strong><span dir="auto">🎤 {track.artist}{track.duration ? ` · ${track.duration}` : ""} · {trackSource(track.id) === "youtube" ? "YouTube" : "Spotify"}</span></div><div className="queue-submitter"><span className={`avatar ${track.color}`}>{track.submitterInitials}</span><small>Added by</small><strong>{track.submittedBy}</strong></div></li>)}</ol></> : <div className="host-queue-empty"><span>{party.status === "ended" ? "✅" : "🪹"}</span><div><strong>{party.status === "ended" ? "Nothing was left behind." : "The queue is gloriously empty."}</strong><p>{party.status === "ended" ? "Every queued song got its moment, or met a strategically timed skip." : "Share the room code and let somebody make a questionable musical decision."}</p></div></div>}</section>
    <section className="host-history-card"><div className="card-title-row"><h2>📊 SONG OUTCOMES</h2><span>{party.songHistory.length} {party.songHistory.length === 1 ? "SONG" : "SONGS"}</span></div>{party.songHistory.length ? <ol>{party.songHistory.map((track) => { const outcome = hostSongOutcome(track); return <li key={track.queueId}><span className={`queue-art ${track.color}`}>{trackSource(track.id) === "youtube" ? "▶️" : "🎵"}</span><div className="history-track-copy"><strong dir="auto">{track.title}</strong><span dir="auto">🎤 {track.artist}{track.duration ? ` · ${track.duration}` : ""} · {trackSource(track.id) === "youtube" ? "YouTube" : "Spotify"}</span><small>Added by {track.submittedBy}</small></div><b className={`song-outcome ${outcome.tone}`}>{outcome.label}</b></li>; })}</ol> : <div className="host-history-empty"><span>🧪</span><div><strong>No outcomes yet.</strong><p>Completed songs and dramatic boo-skips will become permanent evidence here.</p></div></div>}</section>
    <section className="leaderboard-card"><div className="card-title-row"><h2>{party.status === "ended" ? "🏆 FINAL SCOREBOARD" : party.status === "lobby" ? "🌙 LOBBY ROSTER" : "⚡ LIVE SCOREBOARD"}</h2><span>🎉 {party.people.length} PLAYERS</span></div><ol>{[...party.people].sort((a, b) => b.score - a.score).map((person, index) => <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{party.status === "lobby" ? index + 1 : index === 0 ? "👑" : index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>)}</ol></section>

    <HostEffectsBoundary><HostEffects bursts={bursts} alert={hostAlert} shaking={shaking} blackout={blackout} /></HostEffectsBoundary>
    {message && <div className="toast host-toast" role="status">{message}</div>}
    {party.status !== "ended" && renameOpen && <div className="modal-backdrop host-rename-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && !renameBusy && setRenameOpen(false)}><section className="host-rename-card" role="dialog" aria-modal="true" aria-labelledby="host-rename-title" aria-describedby="host-rename-description"><div className="host-rename-handle" aria-hidden="true" /><div className="modal-topline"><div><p className="eyebrow">✏️ SAME PARTY, NEW LABEL</p><h2 id="host-rename-title">Rename the chaos.</h2></div><button className="close-button" type="button" onClick={() => setRenameOpen(false)} disabled={renameBusy} aria-label="Close event rename">×</button></div><p id="host-rename-description">Only the name changes. Room code, passcode, songs, scores, history, and questionable decisions remain exactly where you left them.</p><form className="host-rename-form" onSubmit={renameEvent}><label htmlFor="host-event-name">EVENT NAME</label><input ref={renameInputRef} id="host-event-name" value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} minLength={3} maxLength={60} required /><small>{renameTitle.trim().length}/60 characters · dramatic rebranding is optional</small><div><button className="host-rename-cancel" type="button" onClick={() => setRenameOpen(false)} disabled={renameBusy}>Never mind</button><button className="host-rename-save" type="submit" disabled={renameBusy || renameTitle.trim() === party.title}>{renameBusy ? "Renaming the paperwork…" : "✨ Save new name"}</button></div></form></section></div>}
    {readinessOpen && <div className="modal-backdrop host-readiness-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setReadinessOpen(false)}><section className="host-readiness-card" role="dialog" aria-modal="true" aria-labelledby="host-readiness-title"><div className="host-readiness-handle" aria-hidden="true" /><div className="modal-topline"><div><p className="eyebrow">🧪 PRE-FLIGHT · {hostDeviceName.toUpperCase()}</p><h2 id="host-readiness-title">{readinessRunning ? "Checking this device…" : readinessResults?.some((result) => result.status === "fail") ? "Fix these before guests arrive." : readinessResults?.some((result) => result.status === "warn") ? "Almost ready. Read the notes." : "This device is ready to host."}</h2></div><button ref={closeReadinessRef} className="close-button" type="button" onClick={() => setReadinessOpen(false)} aria-label="Close readiness check">×</button></div><p className="host-readiness-intro">One tap armed the sounds, requested the wake lock, and probed playback, the player, and the room connection. Results are for this browser only.</p><ol className="host-readiness-results" aria-live="polite">{(readinessResults ?? []).map((result) => <li className={`readiness-${result.status}`} key={result.id}><span aria-hidden="true">{result.status === "pass" ? "✅" : result.status === "warn" ? "⚠️" : result.status === "fail" ? "❌" : "ℹ️"}</span><div><strong>{result.label}</strong><p>{result.detail}</p></div></li>)}{readinessRunning && <li className="readiness-info"><span aria-hidden="true">⏳</span><div><strong>Running checks…</strong><p>Listening for the cheer and boo, then probing playback about two seconds later.</p></div></li>}</ol>{readHostEvents().length > 0 && <details className="host-sound-log host-event-log"><summary>🧾 Recent playback events ({readHostEvents().length})</summary><ol>{readHostEvents().map((entry, index) => <li key={`${entry.at}-${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(entry.at))}</time><strong>{entry.event}</strong><small>{entry.detail}</small></li>)}</ol><p>Every song change on this device is listed with what asked for it: the YouTube player, Spotify, a host button, or the crowd.</p></details>}{inspectReactionAudio().recentSounds.length > 0 && <details className="host-sound-log"><summary>🔎 Recent sounds on this device ({inspectReactionAudio().recentSounds.length})</summary><ol>{inspectReactionAudio().recentSounds.map((entry, index) => <li key={`${entry.at}-${index}`}><time dateTime={entry.at}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(entry.at))}</time><strong>{entry.sound === "up" ? "🙌 cheer" : entry.sound === "down" ? "👻 boo" : `🎛️ ${entry.sound}`}</strong><span>{entry.path}</span><small>{entry.reason}</small></li>)}</ol><p>If a sound played that nobody triggered, the reason column tells you which activity item or effect caused it.</p></details>}<div className="host-readiness-reminders"><strong>📋 Before the party, on this device</strong><ul><li>Auto-Lock → Never, Low Power Mode off, charger connected.</li><li>Volume up, mute switch off, Do Not Disturb on so notifications cannot interrupt audio.</li><li>Keep this tab in the foreground for the whole event. No Split View, no app switching.</li><li>{partyMusicSource === "youtube" ? "When the first video arrives, tap Start speaker, then tap the video once if it does not begin." : "Keep the Spotify connection on this device; it cannot move to another one."}</li></ul></div><div className="host-readiness-actions"><button type="button" onClick={startReadinessCheck} disabled={readinessRunning}>{readinessRunning ? "Checking…" : "🔁 Run again"}</button><button className="host-readiness-done" type="button" onClick={() => setReadinessOpen(false)}>Got it</button></div>{readinessCheckedAt && !readinessRunning && <small>Checked at {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(readinessCheckedAt))}</small>}</section></div>}
    {party.status !== "ended" && handoffOpen && <div className="modal-backdrop host-transfer-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setHandoffOpen(false)}><section className="host-transfer-card" role="dialog" aria-modal="true" aria-labelledby="host-transfer-title"><div className="host-transfer-handle" aria-hidden="true" /><div className="modal-topline"><div><p className="eyebrow">🎚️ HIGHLY CONTROLLED MUTINY</p><h2 id="host-transfer-title">Pass the aux.</h2></div><button ref={closeHandoffRef} className="close-button" type="button" onClick={() => setHandoffOpen(false)} aria-label="Close host handoff">×</button></div>{handoffInvite ? <div className="host-transfer-ready"><div className="host-transfer-ticket"><span>ONE-USE HOST LINK FOR</span><strong>{handoffInvite.targetName}</strong><small>Expires at {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(handoffInvite.expiresAt))}</small></div><p>Send this only to the chosen human. When they accept, this browser loses host control and disconnects from DJ duty.</p><code>{handoffInvite.url}</code><div className="host-transfer-actions"><button type="button" onClick={() => void copyHandoff()}>📋 Copy handoff</button><button type="button" onClick={() => void shareHandoff()}>🚀 Share privately</button></div><button className="host-transfer-cancel" type="button" disabled={handoffBusy} onClick={() => void cancelHandoff()}>{handoffBusy ? "Cancelling…" : "🧯 Cancel this tiny coup"}</button></div> : <><p className="host-transfer-intro">Choose one joined human. They get a targeted link that works once, for 10 minutes. No permanent master password wandering around the internet.</p><div className="host-transfer-warning"><strong>🔊 The speaker stays with the device, not the crown.</strong><span>The new host must press Start speaker on their device (and connect Spotify there for Spotify songs). When they accept, this host tab retires automatically.</span></div><div className="host-transfer-people" role="group" aria-label="Humans eligible to become host">{party.people.filter((person) => person.name !== "You").map((person) => <button type="button" disabled={handoffBusy} onClick={() => void prepareHandoff(person.id)} key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><span><strong>{person.name}</strong><small>{handoffBusy ? "Preparing the paperwork…" : "Make this human the next host"}</small></span><b>→</b></button>)}</div>{party.people.length <= 1 && <div className="host-transfer-empty"><strong>🦗 No eligible humans yet.</strong><span>Invite someone into the room first. Transferring control to yourself is just refreshing with extra paperwork.</span></div>}<small className="host-transfer-footnote">🔐 The raw handoff secret lives only in the link. HackMusic stores a one-way hash until it expires.</small></>}</section></div>}
    {party.status !== "ended" && endConfirmOpen && <div className="modal-backdrop end-confirm-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEndConfirmOpen(false)}><section className="end-confirm-card" role="dialog" aria-modal="true" aria-labelledby="end-confirm-title" aria-describedby="end-confirm-description"><p className="eyebrow">🚨 POINT OF NO RETURN</p><h2 id="end-confirm-title">End the party? 🥲</h2><p id="end-confirm-description">This freezes every score and closes the room for new songs and votes. There is no undo.</p><div className="end-confirm-actions"><button ref={cancelEndRef} className="keep-partying" type="button" onClick={() => setEndConfirmOpen(false)}>🎉 Nope, keep partying</button><button className="really-end-party" type="button" disabled={busy} onClick={() => { setEndConfirmOpen(false); void control("end"); }}>{busy ? "⏳ Ending…" : "🏁 Yes, end it forever"}</button></div><small>Press Escape or tap outside to cancel.</small></section></div>}
  </main>;
}
