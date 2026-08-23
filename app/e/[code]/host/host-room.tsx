"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectHostDevice, type HostDevice } from "../../../../lib/host-device";
import { formatPartyStart, formatPlaybackTime, durationMilliseconds as trackDurationMilliseconds, hostSongOutcome } from "../../../../lib/party-format";
import type { HostParty } from "../../../../lib/party-contract";
import { extractSpotifyTrackId } from "../../../../lib/spotify-track";
import type { SpotifyPlaybackState, SpotifyPlayer, SpotifyProgress } from "./spotify-sdk";
import { useReactionSounds } from "./use-reaction-sounds";
import { useScreenWakeLock } from "./use-screen-wake-lock";

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
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyStatus, setSpotifyStatus] = useState<"checking" | "disconnected" | "loading" | "ready" | "error">("checking");
  const [spotifyDeviceId, setSpotifyDeviceId] = useState("");
  const [speakerArmed, setSpeakerArmed] = useState(false);
  const [speakerStarting, setSpeakerStarting] = useState(false);
  const [spotifyProgress, setSpotifyProgress] = useState<SpotifyProgress>({ position: 0, duration: 0, paused: true, trackUri: "" });
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [hostDevice, setHostDevice] = useState<HostDevice>("unknown");
  const knownSoundActivityRef = useRef<Set<string> | null>(null);
  const soundActivityCursorRef = useRef("");
  const cancelEndRef = useRef<HTMLButtonElement | null>(null);
  const spotifyPlayerRef = useRef<SpotifyPlayer | null>(null);
  const lastSpotifyTrackRef = useRef("");
  const previousPartyTrackRef = useRef("");
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null);
  const spotifyStateReceivedAtRef = useRef(0);
  const spotifyEndTimerRef = useRef<number | null>(null);
  const advancingTrackRef = useRef(false);
  const roomRefreshInFlightRef = useRef(false);
  const currentSpotifyId = party?.currentTrack ? extractSpotifyTrackId(party.currentTrack.id) : "";
  const partyStatus = party?.status;
  const partyEnded = partyStatus === "ended";
  const hostDeviceName = hostDevice === "ios" ? "iPhone / iPad" : hostDevice === "android" ? "Android device" : hostDevice === "computer" ? "computer" : "device";
  const { enabled: audioEnabled, play: playReactionSound, enableAndTest: enableReactionAudio, disable: disableReactionAudio } = useReactionSounds(spotifyPlayerRef, setMessage);
  const { supported: wakeLockSupported, active: wakeLockActive, request: requestScreenWakeLock, release: releaseScreenWakeLock } = useScreenWakeLock(hostDeviceName, setMessage);
  const wakeLockStatus = wakeLockActive
    ? `✅ This ${hostDeviceName} will stay awake while the host tab remains visible.`
    : wakeLockSupported === false
      ? `⚠️ Automatic wake lock is unavailable here. Open the ${hostDeviceName} fallback below.`
      : `💤 Keep this ${hostDeviceName} awake during the party.`;

  useEffect(() => {
    const participant = window.localStorage.getItem(`hackmusic:${code}:participant`) ?? "";
    const key = window.localStorage.getItem(`hackmusic:${code}:host`) ?? "";
    const savedSpotifyClientId = window.localStorage.getItem("hackmusic:spotify:clientId") ?? "";
    const savedJoinPasscode = window.localStorage.getItem(`hackmusic:${code}:joinPasscode`) ?? "";
    const url = `${window.location.origin}/e/${code}`;
    queueMicrotask(() => {
      setParticipantId(participant);
      setHostKey(key);
      setShareUrl(url);
      setSpotifyClientId(savedSpotifyClientId);
      setJoinPasscode(savedJoinPasscode);
      setHostDevice(detectHostDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
      if (!participant || !key) setError("This browser did not create that room, so its host controls are locked.");
    });
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#151515", light: "#fffef9" } }).then(setQrUrl).catch(() => undefined);
  }, [code]);

  useEffect(() => {
    const updateProgress = () => {
      const state = lastPlaybackStateRef.current;
      if (!state) return;
      const position = state.paused
        ? state.position
        : Math.min(state.duration, state.position + Math.max(0, Date.now() - spotifyStateReceivedAtRef.current));
      setSpotifyProgress({
        position,
        duration: state.duration,
        paused: state.paused,
        trackUri: state.track_window.current_track.uri,
      });
    };
    const timer = window.setInterval(updateProgress, 500);
    return () => window.clearInterval(timer);
  }, []);

  const refreshParty = useCallback(async (announce = false) => {
    if (!participantId || !hostKey || roomRefreshInFlightRef.current) return false;
    roomRefreshInFlightRef.current = true;
    if (announce) setRoomSyncing(true);
    try {
      const response = await fetch(`/api/party?code=${encodeURIComponent(code)}&activityAfter=${encodeURIComponent(soundActivityCursorRef.current)}`, { headers: { "x-hackmusic-participant": participantId, "x-hackmusic-host-key": hostKey } });
      const data = await response.json().catch(() => null) as { error?: string; party?: HostParty & { activity?: Array<{ id: string; tone: "up" | "down" | "song"; createdAt: string }> } } | null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setError(data?.error ?? "This browser no longer has access to the host controls.");
          return false;
        }
        throw new Error(data?.error ?? "The party service is briefly unavailable.");
      }
      if (!data?.party || !Array.isArray(data.party.queuedTracks)) {
        setError("This browser no longer has the host key for this room.");
        return false;
      }
      const incomingActivity = data.party.activity ?? [];
      if (knownSoundActivityRef.current) {
        incomingActivity
          .filter((item) => item.tone !== "song" && !knownSoundActivityRef.current?.has(item.id))
          .forEach((item) => playReactionSound(item.tone as "up" | "down"));
      }
      const knownIds = knownSoundActivityRef.current ?? new Set<string>();
      incomingActivity.forEach((item) => knownIds.add(item.id));
      knownSoundActivityRef.current = knownIds;
      const lastActivity = incomingActivity[incomingActivity.length - 1];
      if (lastActivity) soundActivityCursorRef.current = `${lastActivity.createdAt}|${lastActivity.id}`;
      setParty(data.party);
      setError("");
      setSyncProblem("");
      if (announce) setMessage("✅ Room data refreshed. Spotify kept playing without interruption.");
      return true;
    } catch {
      setSyncProblem("HackMusic briefly lost the party service. Spotify playback is untouched, and room data will retry automatically.");
      if (announce) setMessage("⚠️ Still reconnecting to room data. Spotify keeps playing.");
      return false;
    } finally {
      roomRefreshInFlightRef.current = false;
      if (announce) setRoomSyncing(false);
    }
  }, [code, hostKey, participantId, playReactionSound]);

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
    if (!participantId || !hostKey || partyEnded) return;
    let active = true;

    async function advanceFinishedTrack() {
      const response = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "advance", code, participantId, pin: hostKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not advance the playlist.");
      if (active) setParty(data.party);
    }

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
              setSpotifyProgress({ position: state.position, duration: state.duration, paused: state.paused, trackUri: state.track_window.current_track.uri });
            } else {
              setSpotifyProgress({ position: 0, duration: 0, paused: true, trackUri: "" });
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
              if (!active || advancingTrackRef.current) return;
              advancingTrackRef.current = true;
              lastSpotifyTrackRef.current = "";
              void advanceFinishedTrack().catch((reason) => {
                advancingTrackRef.current = false;
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
  }, [code, getSpotifyToken, hostKey, participantId, partyEnded]);

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
    lastSpotifyTrackRef.current = trackId;
    advancingTrackRef.current = false;
    setSpeakerArmed(true);
    setSpotifyMessage("🔊 Full track is playing here. HackMusic will start every next song automatically.");
  }, [getSpotifyToken, spotifyDeviceId]);

  async function startHostSpeaker() {
    if (speakerStarting || !currentSpotifyId) return;
    setSpeakerStarting(true);
    setSpotifyMessage("🔊 Starting this browser as the Spotify speaker…");
    void requestScreenWakeLock();
    try {
      await playSpotifyTrack(currentSpotifyId, true);
    } catch (reason) {
      setSpotifyMessage(reason instanceof Error ? reason.message : "Could not start Spotify. Tap once more to retry.");
    } finally {
      setSpeakerStarting(false);
    }
  }

  useEffect(() => {
    const previousTrackId = previousPartyTrackRef.current;
    previousPartyTrackRef.current = currentSpotifyId;
    if (!previousTrackId || previousTrackId === currentSpotifyId || !hostKey || !participantId) return;
    const state = lastPlaybackStateRef.current;
    if (!state || extractSpotifyTrackId(state.track_window.current_track.uri) !== previousTrackId || state.duration <= 0) return;
    const playedPosition = state.paused
      ? state.position
      : Math.min(state.duration, state.position + Math.max(0, Date.now() - spotifyStateReceivedAtRef.current));
    const skipPercent = Math.max(0, Math.min(100, Math.round((playedPosition / state.duration) * 100)));
    void fetch("/api/party", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "skipProgress", code, participantId, pin: hostKey, trackId: `spotify:track:${previousTrackId}`, skipPercent }),
    }).then(async (response) => {
      const data = await response.json();
      if (response.ok) setParty(data.party);
    }).catch(() => undefined);
  }, [code, currentSpotifyId, hostKey, participantId]);

  useEffect(() => {
    if (!speakerArmed || !spotifyPlayerRef.current) return;
    if (party?.status === "ended" || !currentSpotifyId) {
      lastSpotifyTrackRef.current = "";
      void spotifyPlayerRef.current.pause();
      return;
    }
    if (spotifyStatus === "ready" && spotifyDeviceId && lastSpotifyTrackRef.current !== currentSpotifyId) {
      void playSpotifyTrack(currentSpotifyId).catch((reason) => {
        setSpotifyMessage(reason instanceof Error ? reason.message : "Could not play this song.");
      });
    }
  }, [currentSpotifyId, party?.status, playSpotifyTrack, speakerArmed, spotifyDeviceId, spotifyStatus]);

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
    lastSpotifyTrackRef.current = "";
    lastPlaybackStateRef.current = null;
    spotifyStateReceivedAtRef.current = 0;
    setSpotifyProgress({ position: 0, duration: 0, paused: true, trackUri: "" });
    setSpeakerArmed(false);
    setSpotifyDeviceId("");
    setSpotifyStatus("disconnected");
    setSpotifyMessage("👋 Spotify disconnected from this browser.");
  }

  async function control(action: "start" | "skip" | "advance" | "end") {
    setBusy(true);
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

  if (error && !party) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">HOST KEY REQUIRED</p><h1>{error}</h1><a href={`/e/${code}`}>Open the participant room →</a><a href="/">Create a new room →</a></main>;
  if (syncProblem && !party) return <main className="missing-room host-reconnect-screen"><span className="brand-mark">HM</span><p className="eyebrow">📡 RECONNECTING THE DJ BOOTH</p><h1>Connection hiccup.</h1><p>{syncProblem}</p><button type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "Trying again…" : "↻ Try room data again"}</button><a href={`/e/${code}`} target="_blank" rel="noreferrer">Open participant view safely ↗</a></main>;
  if (!party) return <main className="loading-room"><span className="brand-mark">HM</span><p>Warming up room {code}…</p></main>;

  const cheers = party.reactions.filter((reaction) => reaction.tone === "up").length;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;
  const progressMatchesCurrent = Boolean(currentSpotifyId && spotifyProgress.trackUri.endsWith(currentSpotifyId));
  const progressDuration = progressMatchesCurrent && spotifyProgress.duration > 0 ? spotifyProgress.duration : trackDurationMilliseconds(party.currentTrack?.duration ?? "");
  const progressPosition = progressMatchesCurrent ? Math.min(spotifyProgress.position, progressDuration || spotifyProgress.position) : 0;
  const progressPercent = progressDuration > 0 ? Math.min(100, Math.max(0, progressPosition / progressDuration * 100)) : 0;
  const progressState = speakerStarting ? "STARTING" : speakerArmed && progressMatchesCurrent ? spotifyProgress.paused ? "PAUSED" : "PLAYING" : speakerArmed ? "LOADING" : "READY";
  const spotifyCallbackUrl = shareUrl ? new URL("/api/spotify/callback", shareUrl).toString() : "";
  return <main className="host-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></a><a className="participant-link" href={`/e/${code}`} target="_blank" rel="noreferrer">{party.status === "ended" ? "🏆 View final party page ↗" : "🎉 Open participant page safely ↗"}</a></header>
    <div className="host-heading"><div><p className="eyebrow">🎛️ HOST CONTROL · ROOM {party.code}</p><h1>{party.title}</h1></div><div className="host-heading-actions"><span className={`host-status ${party.status}`}>{party.status === "ended" ? "🏁 PARTY ENDED" : party.status === "lobby" ? "🌙 LOBBY OPEN" : "⚡ LIVE"}</span>{party.status !== "ended" && <><button className="host-soft-refresh" type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "↻ SYNCING…" : "↻ REFRESH ROOM DATA"}</button><small>Safe refresh · music keeps playing</small></>}</div></div>

    {(syncProblem || error) && <section className={`host-sync-banner ${error ? "access" : "offline"}`} role="status"><div><strong>{error ? "🔐 Host access needs attention" : "📡 Room data is reconnecting"}</strong><span>{error || syncProblem}</span><small>{error ? "Spotify may continue, but host controls need the creator browser." : "Do not reload. Automatic retries are running and Spotify is untouched."}</small></div><button type="button" onClick={() => void refreshParty(true)} disabled={roomSyncing}>{roomSyncing ? "Trying…" : "Try now →"}</button></section>}

    {party.status === "ended" ? <section className="host-ended-summary"><div><p className="eyebrow">🏁 THE AUX CABLE HAS BEEN RETIRED</p><h2>That&apos;s a wrap.</h2><p>Scores are frozen, voting is closed, and the speaker can finally process what happened.</p></div><div className="host-ended-summary-stats"><span><strong>{party.people.length}</strong> humans</span><span><strong>{party.queuedTracks.length}</strong> unplayed</span></div><div className="host-ended-summary-actions"><a href={`/e/${code}`}>🏆 View final party page →</a><a href="/">🎉 Create another room</a></div></section> : <section className="share-room-card"><div className="share-code"><span>📱 ROOM CODE</span><strong>{party.code}</strong>{joinPasscode ? <div className="share-passcode"><span>🔐 JOIN PASSCODE</span><strong>{joinPasscode}</strong><small>Not included in the URL or QR code. Copy/Share sends both.</small></div> : <div className="share-passcode-warning"><strong>{party.requiresPasscode ? "🔐 Passcode hidden on this browser" : "🚨 Legacy room: no passcode yet"}</strong><span>{party.requiresPasscode ? "Set a new one below if the original is lost." : "Lock it before sharing the room."}</span></div>}<details className="replace-passcode"><summary>{joinPasscode ? "Rotate room passcode" : "Set a room passcode"}</summary><form onSubmit={replaceJoinPasscode}><label htmlFor="replacement-passcode">NEW PASSCODE</label><input id="replacement-passcode" value={replacementPasscode} onChange={(event) => setReplacementPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="new-password" placeholder="e.g. VIBE42" required /><button type="submit" disabled={busy}>🔐 Save new passcode</button></form></details><p>{shareUrl}</p><div><button type="button" onClick={() => void copyInvite()}>📋 Copy invite</button><button type="button" onClick={() => void shareInvite()}>🚀 Share</button></div></div>{qrUrl && <Image unoptimized src={qrUrl} width={180} height={180} alt={`QR code to join room ${party.code}`} />}</section>}

    {party.status === "lobby" && <section className="host-lobby-card"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY IS OPEN</p><h2>Let the queue marinate.</h2><p>Expected start: <strong>{formatPartyStart(party.scheduledFor, "Whenever you say go")}</strong></p><small>Guests can join and add songs now. Playback and reactions stay locked until you start.</small></div><div className="host-lobby-action"><span><strong>{party.people.length}</strong> humans · <strong>{party.queueCount}</strong> secret songs</span><button type="button" disabled={busy} onClick={() => void control("start")}>{busy ? "🚀 Starting…" : "🚀 Start the party now →"}</button><small>You control the exact start time. This cannot return to lobby mode.</small></div></section>}

    {party.status !== "ended" && <section className={`spotify-connect-card spotify-${spotifyStatus}`}>
      <div className="spotify-connect-heading">
        <div><p className="eyebrow">🔊 FULL-TRACK SPEAKER</p><h2>Spotify Premium</h2></div>
        <span>{spotifyStatus === "ready" ? "✅ CONNECTED" : spotifyStatus === "loading" || spotifyStatus === "checking" ? "🔎 CHECKING…" : "🛠️ SETUP NEEDED"}</span>
      </div>
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

    <div className="host-grid"><section className="host-now-card"><div className="section-kicker"><span>{party.status === "ended" ? "📼 LAST SONG" : party.status === "lobby" ? "🌙 SPEAKER SLEEPING" : "🔊 ON THE SPEAKER"}</span><span>{party.status === "ended" ? `📦 ${party.queueCount} UNPLAYED` : `🤫 ${party.queueCount} WAITING`}</span></div>{party.currentTrack ? <><div className="host-track"><div className={`host-art ${party.currentTrack.color}`}>🎵</div><div><h2>{party.currentTrack.title}</h2><p>{party.currentTrack.artist}{party.currentTrack.duration ? ` · ${party.currentTrack.duration}` : ""}</p></div></div>{party.status !== "ended" && (currentSpotifyId ? <div className={`spotify-host-player spotify-${spotifyStatus}`}><div><strong>🟢 SPOTIFY PREMIUM SPEAKER</strong><span>{spotifyStatus === "ready" ? "🎶 Full song · no preview limit" : "👆 Connect Spotify above first"}</span></div><button type="button" disabled={speakerStarting || spotifyStatus !== "ready" || party.status !== "live"} onClick={() => void startHostSpeaker()}>{speakerStarting ? "🔊 Starting speaker…" : speakerArmed ? "🔁 Play this track again →" : "🔊 Start speaker →"}</button><div className={`host-playback-progress ${progressState.toLowerCase()}`}><div><strong>{formatPlaybackTime(progressPosition)}</strong><span>{progressState === "PLAYING" ? "⚡ PLAYING" : progressState === "PAUSED" ? "⏸ PAUSED" : progressState === "STARTING" ? "🔊 STARTING" : progressState === "LOADING" ? "⏳ LOADING TRACK" : "👆 READY TO START"}</span><strong>{formatPlaybackTime(progressDuration)}</strong></div><div className="host-progress-track" role="progressbar" aria-label={`Spotify playback: ${formatPlaybackTime(progressPosition)} of ${formatPlaybackTime(progressDuration)}`} aria-valuemin={0} aria-valuemax={Math.max(1, progressDuration)} aria-valuenow={Math.round(progressPosition)}><span style={{ width: `${progressPercent}%` }} /></div></div><small>👉 Starts Spotify only. Funny sounds stay off unless you enable them separately.</small></div> : <div className="unplayable-track"><strong>⚠️ This older queue item has no Spotify track token.</strong><span>Skip this legacy item once. Every newly added song is now validated before it enters the queue.</span></div>)}<div className="host-reaction-counts"><div className="host-cheers"><strong>{cheers}</strong><span>🙌 CHEERS</span></div><div className="host-boos"><strong>{boos}</strong><span>👻 BOOS</span></div></div></> : <div className="host-empty"><strong>{party.status === "ended" ? "🏁 The speaker is off." : party.status === "lobby" ? "🌙 Playback is locked." : "🦗 No song yet."}</strong><p>{party.status === "ended" ? "The final scoreboard and any unplayed songs are saved below." : party.status === "lobby" ? `🤫 ${party.queueCount} secret ${party.queueCount === 1 ? "song is" : "songs are"} waiting for your launch.` : "🎵 Open the participant page and add the first one."}</p></div>}</section>
      {party.status === "ended" ? <section className="host-controls-card host-controls-retired"><div className="card-title-row"><h2>🧊 CONTROLS FROZEN</h2><span>FINAL</span></div><div className="host-retired-mark">🏁</div><h3>The buttons have left the building.</h3><p>Playback, reactions, invitations, passcodes, queue rules, funny sounds, and screen wake lock are finished for this room.</p><a href="/">Start fresh with a new party →</a></section> : <section className="host-controls-card"><div className="card-title-row"><h2>🎛️ CONTROLS</h2><span>📱 HOST DEVICE</span></div><button className={`host-audio ${audioEnabled ? "armed" : ""}`} type="button" aria-pressed={audioEnabled} onClick={audioEnabled ? disableAudio : enableAudio}>{audioEnabled ? "🔇 Disable funny sounds" : "🎉 Enable & test funny sounds"}</button><button className={`host-wake-lock ${wakeLockActive ? "armed" : ""}`} type="button" aria-pressed={wakeLockActive} disabled={wakeLockSupported === false} onClick={() => wakeLockActive ? void releaseScreenWakeLock() : void requestScreenWakeLock()}>{wakeLockActive ? "🔒 Screen staying awake · tap to release" : wakeLockSupported === false ? "⚠️ Screen wake lock unavailable" : "☀️ Keep this screen awake"}</button><button className="host-skip" type="button" disabled={busy || !party.currentTrack} onClick={() => void control("skip")}>⏭️ Skip to next song →</button><button className="host-end" type="button" disabled={busy} onClick={() => setEndConfirmOpen(true)}>🏁 End party & freeze scores</button><p className={`host-wake-status ${wakeLockActive ? "active" : ""}`}>{wakeLockStatus}</p><details className="host-wake-guide"><summary>🛟 Screen-awake help · detected {hostDeviceName}</summary><ul><li className={hostDevice === "ios" ? "current" : ""}><strong>🍎 iPhone / iPad</strong><span>Try the button first. If unavailable, use Settings → Display &amp; Brightness → Auto-Lock and choose Never or the longest available time.</span></li><li className={hostDevice === "android" ? "current" : ""}><strong>🤖 Android</strong><span>Try the button first. Otherwise increase Display → Screen timeout, or enable Developer options → Stay awake while charging.</span></li><li className={hostDevice === "computer" ? "current" : ""}><strong>💻 Computer</strong><span>Keep this tab visible. If needed, temporarily disable display sleep in the computer’s power or display settings.</span></li></ul></details><p className="host-hint">🔊 Reaction sounds play only from this host device. Keep this page open and its volume up.</p></section>}
    </div>
    <section className="host-queue-card"><div className="card-title-row"><h2>{party.status === "ended" ? "📦 UNPLAYED AT CLOSING" : "🎶 WAITING IN THE QUEUE"}</h2><span>{party.status === "ended" ? "ARCHIVE" : "🤫"} {party.queuedTracks.length} {party.queuedTracks.length === 1 ? "SONG" : "SONGS"}</span></div>{party.status !== "ended" && <fieldset className="queue-mode-picker"><legend>HOW SHOULD THE NEXT SONG BE PICKED?</legend><div>{queueModes.map((mode) => <button className={party.queueMode === mode.id ? "active" : ""} type="button" aria-pressed={party.queueMode === mode.id} disabled={busy} onClick={() => void changeQueueMode(mode.id)} key={mode.id}><span className="queue-mode-icon">{mode.icon}</span><span className="queue-mode-copy"><strong>{mode.title}</strong><small>{mode.copy}</small></span><span className="queue-mode-state">{party.queueMode === mode.id ? "✓ ACTIVE" : "SELECT"}</span></button>)}</div></fieldset>}{party.queuedTracks.length ? <><p className="queue-order-note">{party.status === "ended" ? "📼 These songs were still waiting when the final bell rang." : party.queueMode === "ordered" ? "📍 The numbered list below is the exact play order." : party.queueMode === "random" ? "🎲 These songs are the chaos pool. The next one is chosen only when it’s time." : "⚖️ These songs are the fair-play pool. HackMusic balances people first, then rolls the dice."}</p><ol className="host-queue-list">{party.queuedTracks.map((track, index) => <li key={track.queueId}><span className="queue-position">{party.status === "ended" ? String(index + 1).padStart(2, "0") : party.queueMode === "ordered" ? String(index + 1).padStart(2, "0") : party.queueMode === "random" ? "🎲" : "⚖️"}</span><span className={`queue-art ${track.color}`}>🎵</span><div className="queue-track-copy"><strong dir="auto">{track.title}</strong><span dir="auto">🎤 {track.artist}{track.duration ? ` · ${track.duration}` : ""}</span></div><div className="queue-submitter"><span className={`avatar ${track.color}`}>{track.submitterInitials}</span><small>Added by</small><strong>{track.submittedBy}</strong></div></li>)}</ol></> : <div className="host-queue-empty"><span>{party.status === "ended" ? "✅" : "🪹"}</span><div><strong>{party.status === "ended" ? "Nothing was left behind." : "The queue is gloriously empty."}</strong><p>{party.status === "ended" ? "Every queued song got its moment, or met a strategically timed skip." : "Share the room code and let somebody make a questionable musical decision."}</p></div></div>}</section>
    <section className="host-history-card"><div className="card-title-row"><h2>📊 SONG OUTCOMES</h2><span>{party.songHistory.length} {party.songHistory.length === 1 ? "SONG" : "SONGS"}</span></div>{party.songHistory.length ? <ol>{party.songHistory.map((track) => { const outcome = hostSongOutcome(track); return <li key={track.queueId}><span className={`queue-art ${track.color}`}>🎵</span><div className="history-track-copy"><strong dir="auto">{track.title}</strong><span dir="auto">🎤 {track.artist}{track.duration ? ` · ${track.duration}` : ""}</span><small>Added by {track.submittedBy}</small></div><b className={`song-outcome ${outcome.tone}`}>{outcome.label}</b></li>; })}</ol> : <div className="host-history-empty"><span>🧪</span><div><strong>No outcomes yet.</strong><p>Completed songs and dramatic boo-skips will become permanent evidence here.</p></div></div>}</section>
    <section className="leaderboard-card"><div className="card-title-row"><h2>{party.status === "ended" ? "🏆 FINAL SCOREBOARD" : party.status === "lobby" ? "🌙 LOBBY ROSTER" : "⚡ LIVE SCOREBOARD"}</h2><span>🎉 {party.people.length} PLAYERS</span></div><ol>{[...party.people].sort((a, b) => b.score - a.score).map((person, index) => <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{party.status === "lobby" ? index + 1 : index === 0 ? "👑" : index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>)}</ol></section>

    {message && <div className="toast host-toast" role="status">{message}</div>}
    {party.status !== "ended" && endConfirmOpen && <div className="modal-backdrop end-confirm-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEndConfirmOpen(false)}><section className="end-confirm-card" role="dialog" aria-modal="true" aria-labelledby="end-confirm-title" aria-describedby="end-confirm-description"><p className="eyebrow">🚨 POINT OF NO RETURN</p><h2 id="end-confirm-title">End the party? 🥲</h2><p id="end-confirm-description">This freezes every score and closes the room for new songs and votes. There is no undo.</p><div className="end-confirm-actions"><button ref={cancelEndRef} className="keep-partying" type="button" onClick={() => setEndConfirmOpen(false)}>🎉 Nope, keep partying</button><button className="really-end-party" type="button" disabled={busy} onClick={() => { setEndConfirmOpen(false); void control("end"); }}>{busy ? "⏳ Ending…" : "🏁 Yes, end it forever"}</button></div><small>Press Escape or tap outside to cancel.</small></section></div>}
  </main>;
}
