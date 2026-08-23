"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { detectHostDevice, type HostDevice } from "../../../../lib/host-device";
import { extractSpotifyTrackId } from "../../../../lib/spotify-track";

type HostParty = {
  code: string;
  title: string;
  status: "lobby" | "live" | "ended";
  scheduledFor: string | null;
  requiresPasscode: boolean;
  currentTrack: { id: string; title: string; artist: string; duration: string; color: string } | null;
  people: Array<{ id: string; name: string; score: number; initials: string; color: string }>;
  reactions: Array<{ id: string; tone: "up" | "down" }>;
  queueCount: number;
  queueMode: "ordered" | "random" | "fair";
  queuedTracks: Array<{ queueId: string; id: string; title: string; artist: string; duration: string; color: string; submittedBy: string; submitterInitials: string }>;
};

const queueModes = [
  { id: "ordered", icon: "📬", title: "Submitted order", copy: "First submitted, first played. Predictable and tidy." },
  { id: "random", icon: "🎲", title: "Pure chaos", copy: "Every waiting song has an equal shot at being next." },
  { id: "fair", icon: "⚖️", title: "Fair-ish shuffle", copy: "People heard least go first; ties stay delightfully random." },
] as const;

function partyStartTime(value: string | null) {
  if (!value) return "Whenever you say go";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Whenever you say go" : new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } };
};

type SpotifyProgress = {
  position: number;
  duration: number;
  paused: boolean;
  trackUri: string;
};

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  getVolume: () => Promise<number>;
  setVolume: (volume: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  addListener: {
    (event: "ready" | "not_ready", callback: (payload: { device_id: string }) => void): boolean;
    (event: "player_state_changed", callback: (state: SpotifyPlaybackState | null) => void): boolean;
    (event: "autoplay_failed", callback: () => void): boolean;
    (event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (payload: { message: string }) => void): boolean;
  };
};

const REACTION_DUCK_VOLUME = 0.16;
const REACTION_SOUND_VERSION = "2026-08-23-3";
const waitForAudioFade = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function formatPlaybackTime(milliseconds: number) {
  const safeSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function trackDurationMilliseconds(value: string) {
  const match = value.match(/^(\d+):(\d{2})$/);
  return match ? (Number(match[1]) * 60 + Number(match[2])) * 1_000 : 0;
}

type SpotifyConstructor = new (options: {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
  enableMediaSession?: boolean;
}) => SpotifyPlayer;

type ScreenWakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (event: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<ScreenWakeLockSentinel> };
};

declare global {
  interface Window {
    Spotify?: { Player: SpotifyConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

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
  const [busy, setBusy] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [spotifyClientId, setSpotifyClientId] = useState("");
  const [spotifyStatus, setSpotifyStatus] = useState<"checking" | "disconnected" | "loading" | "ready" | "error">("checking");
  const [spotifyDeviceId, setSpotifyDeviceId] = useState("");
  const [speakerArmed, setSpeakerArmed] = useState(false);
  const [speakerStarting, setSpeakerStarting] = useState(false);
  const [spotifyProgress, setSpotifyProgress] = useState<SpotifyProgress>({ position: 0, duration: 0, paused: true, trackUri: "" });
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean | null>(() => typeof navigator === "undefined" ? null : Boolean((navigator as NavigatorWithWakeLock).wakeLock));
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [hostDevice, setHostDevice] = useState<HostDevice>("unknown");
  const audioEnabledRef = useRef(false);
  const cheerAudioRef = useRef<HTMLAudioElement | null>(null);
  const booAudioRef = useRef<HTMLAudioElement | null>(null);
  const knownReactions = useRef<Set<string> | null>(null);
  const cancelEndRef = useRef<HTMLButtonElement | null>(null);
  const spotifyPlayerRef = useRef<SpotifyPlayer | null>(null);
  const spotifyVolumeBeforeDuckRef = useRef<number | null>(null);
  const spotifyPausedForReactionRef = useRef(false);
  const reactionSoundTokenRef = useRef(0);
  const reactionRestoreTimerRef = useRef<number | null>(null);
  const lastSpotifyTrackRef = useRef("");
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null);
  const spotifyStateReceivedAtRef = useRef(0);
  const spotifyEndTimerRef = useRef<number | null>(null);
  const advancingTrackRef = useRef(false);
  const wakeLockRef = useRef<ScreenWakeLockSentinel | null>(null);
  const wakeLockWantedRef = useRef(false);
  const currentSpotifyId = party?.currentTrack ? extractSpotifyTrackId(party.currentTrack.id) : "";
  const partyStatus = party?.status;
  const partyEnded = partyStatus === "ended";
  const hostDeviceName = hostDevice === "ios" ? "iPhone / iPad" : hostDevice === "android" ? "Android device" : hostDevice === "computer" ? "computer" : "device";
  const wakeLockStatus = wakeLockActive
    ? `✅ This ${hostDeviceName} will stay awake while the host tab remains visible.`
    : wakeLockSupported === false
      ? `⚠️ Automatic wake lock is unavailable here. Open the ${hostDeviceName} fallback below.`
      : `💤 Keep this ${hostDeviceName} awake during the party.`;

  const requestScreenWakeLock = useCallback(async (announce = true) => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) {
      setWakeLockSupported(false);
      if (announce) setMessage(`⚠️ This browser cannot keep the ${hostDeviceName} awake automatically. Open the screen-awake help below.`);
      return false;
    }
    setWakeLockSupported(true);
    wakeLockWantedRef.current = true;
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      setWakeLockActive(true);
      return true;
    }
    try {
      const sentinel = await wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
          setWakeLockActive(false);
        }
      });
      if (announce) setMessage(`🔒 Screen lock blocked on this ${hostDeviceName}. Keep the host tab visible.`);
      return true;
    } catch {
      wakeLockWantedRef.current = false;
      setWakeLockActive(false);
      if (announce) setMessage("⚠️ The device rejected the wake lock. Check battery or power-saving settings and the fallback guide below.");
      return false;
    }
  }, [hostDeviceName]);

  const releaseScreenWakeLock = useCallback(async (announce = true) => {
    wakeLockWantedRef.current = false;
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setWakeLockActive(false);
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
    if (announce) setMessage(`💤 Screen wake lock released. This ${hostDeviceName} may sleep again.`);
  }, [hostDeviceName]);

  const playReactionSound = useCallback((kind: "up" | "down") => {
    if (!audioEnabledRef.current) return;
    const sound = kind === "up" ? cheerAudioRef.current : booAudioRef.current;
    if (!sound) return;

    const token = ++reactionSoundTokenRef.current;
    if (reactionRestoreTimerRef.current) {
      window.clearTimeout(reactionRestoreTimerRef.current);
      reactionRestoreTimerRef.current = null;
    }
    cheerAudioRef.current?.pause();
    booAudioRef.current?.pause();
    sound.currentTime = 0;
    sound.volume = 1;

    const restoreMusic = () => {
      if (token !== reactionSoundTokenRef.current) return;
      if (reactionRestoreTimerRef.current) {
        window.clearTimeout(reactionRestoreTimerRef.current);
        reactionRestoreTimerRef.current = null;
      }
      const player = spotifyPlayerRef.current;
      if (spotifyPausedForReactionRef.current) {
        spotifyPausedForReactionRef.current = false;
        if (player) void player.resume().catch(() => undefined);
        return;
      }
      const originalVolume = spotifyVolumeBeforeDuckRef.current;
      if (!player || originalVolume === null) return;
      void (async () => {
        const duckedVolume = Math.min(originalVolume, REACTION_DUCK_VOLUME);
        const steps = 6;
        for (let step = 1; step <= steps; step += 1) {
          if (token !== reactionSoundTokenRef.current || player !== spotifyPlayerRef.current) return;
          const volume = duckedVolume + ((originalVolume - duckedVolume) * step / steps);
          await player.setVolume(volume).catch(() => undefined);
          if (step < steps) await waitForAudioFade(80);
        }
        if (token === reactionSoundTokenRef.current) spotifyVolumeBeforeDuckRef.current = null;
      })();
    };

    const playOverDuckedMusic = async () => {
      const player = spotifyPlayerRef.current;
      if (player) {
        if (hostDevice === "ios") {
          if (!spotifyPausedForReactionRef.current && lastPlaybackStateRef.current && !lastPlaybackStateRef.current.paused) {
            spotifyPausedForReactionRef.current = true;
            await player.pause().catch(() => undefined);
          }
        } else {
          let originalVolume = spotifyVolumeBeforeDuckRef.current;
          if (originalVolume === null) {
            originalVolume = await player.getVolume().catch(() => 0.8);
            if (token !== reactionSoundTokenRef.current || player !== spotifyPlayerRef.current) return;
            spotifyVolumeBeforeDuckRef.current = originalVolume;
            const firstDip = originalVolume + ((Math.min(originalVolume, REACTION_DUCK_VOLUME) - originalVolume) * 0.65);
            await player.setVolume(firstDip).catch(() => undefined);
            await waitForAudioFade(45);
          }
          if (token !== reactionSoundTokenRef.current || player !== spotifyPlayerRef.current) return;
          await player.setVolume(Math.min(originalVolume, REACTION_DUCK_VOLUME)).catch(() => undefined);
        }
      }
      if (token !== reactionSoundTokenRef.current) return;
      sound.onended = restoreMusic;
      sound.onerror = restoreMusic;
      await sound.play();
      const fallbackDuration = Number.isFinite(sound.duration) ? sound.duration * 1_000 + 250 : 3_500;
      reactionRestoreTimerRef.current = window.setTimeout(restoreMusic, fallbackDuration);
    };

    void playOverDuckedMusic().catch(() => {
      restoreMusic();
      setMessage("The phone blocked reaction audio. Tap Enable & test funny sounds again.");
    });
  }, [hostDevice]);

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
    const restoreWhenVisible = () => {
      if (document.visibilityState === "visible" && wakeLockWantedRef.current && !wakeLockRef.current) {
        void requestScreenWakeLock(false);
      }
    };
    document.addEventListener("visibilitychange", restoreWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", restoreWhenVisible);
      wakeLockWantedRef.current = false;
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [requestScreenWakeLock]);

  useEffect(() => {
    const cheerSound = new Audio(`/sounds/woohoo-crowd.wav?v=${REACTION_SOUND_VERSION}`);
    const booSound = new Audio(`/sounds/boo.mp3?v=${REACTION_SOUND_VERSION}`);
    cheerSound.preload = "auto";
    booSound.preload = "auto";
    cheerSound.load();
    booSound.load();
    cheerAudioRef.current = cheerSound;
    booAudioRef.current = booSound;
    return () => {
      reactionSoundTokenRef.current += 1;
      spotifyPausedForReactionRef.current = false;
      if (reactionRestoreTimerRef.current) window.clearTimeout(reactionRestoreTimerRef.current);
      cheerSound.pause();
      booSound.pause();
      cheerAudioRef.current = null;
      booAudioRef.current = null;
    };
  }, []);

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

  useEffect(() => {
    if (!participantId || !hostKey || partyStatus === "ended") return;
    let active = true;
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}`, { headers: { "x-hackmusic-participant": participantId, "x-hackmusic-host-key": hostKey } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (!active) return;
        const nextIds = new Set<string>(data.party.reactions.map((reaction: { id: string }) => reaction.id));
        if (knownReactions.current) {
          data.party.reactions.filter((reaction: { id: string }) => !knownReactions.current?.has(reaction.id)).reverse().forEach((reaction: { tone: "up" | "down" }) => playReactionSound(reaction.tone));
        }
        knownReactions.current = nextIds;
        setParty(data.party);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the room."); });
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [code, hostKey, participantId, partyStatus, playReactionSound]);

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

  function enableAudio() {
    audioEnabledRef.current = true;
    setAudioEnabled(true);
    setMessage("Funny sounds are armed. You should hear a quick cheer and boo test now.");
    const booSound = booAudioRef.current;
    if (booSound) {
      booSound.volume = 0;
      void booSound.play().then(() => {
        booSound.pause();
        booSound.currentTime = 0;
        booSound.volume = 1;
      }).catch(() => undefined);
    }
    playReactionSound("up");
    window.setTimeout(() => playReactionSound("down"), 650);
  }

  function disableAudio() {
    audioEnabledRef.current = false;
    setAudioEnabled(false);
    reactionSoundTokenRef.current += 1;
    if (reactionRestoreTimerRef.current) {
      window.clearTimeout(reactionRestoreTimerRef.current);
      reactionRestoreTimerRef.current = null;
    }
    cheerAudioRef.current?.pause();
    booAudioRef.current?.pause();
    if (cheerAudioRef.current) cheerAudioRef.current.currentTime = 0;
    if (booAudioRef.current) booAudioRef.current.currentTime = 0;
    const player = spotifyPlayerRef.current;
    if (spotifyPausedForReactionRef.current) {
      spotifyPausedForReactionRef.current = false;
      if (player) void player.resume().catch(() => undefined);
    }
    const originalVolume = spotifyVolumeBeforeDuckRef.current;
    spotifyVolumeBeforeDuckRef.current = null;
    if (player && originalVolume !== null) void player.setVolume(originalVolume).catch(() => undefined);
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

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">HOST KEY REQUIRED</p><h1>{error}</h1><a href={`/e/${code}`}>Open the participant room →</a><a href="/">Create a new room →</a></main>;
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
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></a><a className="participant-link" href={`/e/${code}`}>{party.status === "ended" ? "🏆 View final party page →" : "🎉 Open participant page →"}</a></header>
    <div className="host-heading"><div><p className="eyebrow">🎛️ HOST CONTROL · ROOM {party.code}</p><h1>{party.title}</h1></div><span className={`host-status ${party.status}`}>{party.status === "ended" ? "🏁 PARTY ENDED" : party.status === "lobby" ? "🌙 LOBBY OPEN" : "⚡ LIVE"}</span></div>

    {party.status === "ended" ? <section className="host-ended-summary"><div><p className="eyebrow">🏁 THE AUX CABLE HAS BEEN RETIRED</p><h2>That&apos;s a wrap.</h2><p>Scores are frozen, voting is closed, and the speaker can finally process what happened.</p></div><div className="host-ended-summary-stats"><span><strong>{party.people.length}</strong> humans</span><span><strong>{party.queuedTracks.length}</strong> unplayed</span></div><div className="host-ended-summary-actions"><a href={`/e/${code}`}>🏆 View final party page →</a><a href="/">🎉 Create another room</a></div></section> : <section className="share-room-card"><div className="share-code"><span>📱 ROOM CODE</span><strong>{party.code}</strong>{joinPasscode ? <div className="share-passcode"><span>🔐 JOIN PASSCODE</span><strong>{joinPasscode}</strong><small>Not included in the URL or QR code. Copy/Share sends both.</small></div> : <div className="share-passcode-warning"><strong>{party.requiresPasscode ? "🔐 Passcode hidden on this browser" : "🚨 Legacy room: no passcode yet"}</strong><span>{party.requiresPasscode ? "Set a new one below if the original is lost." : "Lock it before sharing the room."}</span></div>}<details className="replace-passcode"><summary>{joinPasscode ? "Rotate room passcode" : "Set a room passcode"}</summary><form onSubmit={replaceJoinPasscode}><label htmlFor="replacement-passcode">NEW PASSCODE</label><input id="replacement-passcode" value={replacementPasscode} onChange={(event) => setReplacementPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="new-password" placeholder="e.g. VIBE42" required /><button type="submit" disabled={busy}>🔐 Save new passcode</button></form></details><p>{shareUrl}</p><div><button type="button" onClick={() => void copyInvite()}>📋 Copy invite</button><button type="button" onClick={() => void shareInvite()}>🚀 Share</button></div></div>{qrUrl && <Image unoptimized src={qrUrl} width={180} height={180} alt={`QR code to join room ${party.code}`} />}</section>}

    {party.status === "lobby" && <section className="host-lobby-card"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY IS OPEN</p><h2>Let the queue marinate.</h2><p>Expected start: <strong>{partyStartTime(party.scheduledFor)}</strong></p><small>Guests can join and add songs now. Playback and reactions stay locked until you start.</small></div><div className="host-lobby-action"><span><strong>{party.people.length}</strong> humans · <strong>{party.queueCount}</strong> secret songs</span><button type="button" disabled={busy} onClick={() => void control("start")}>{busy ? "🚀 Starting…" : "🚀 Start the party now →"}</button><small>You control the exact start time. This cannot return to lobby mode.</small></div></section>}

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
    <section className="leaderboard-card"><div className="card-title-row"><h2>{party.status === "ended" ? "🏆 FINAL SCOREBOARD" : party.status === "lobby" ? "🌙 LOBBY ROSTER" : "⚡ LIVE SCOREBOARD"}</h2><span>🎉 {party.people.length} PLAYERS</span></div><ol>{[...party.people].sort((a, b) => b.score - a.score).map((person, index) => <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{party.status === "lobby" ? index + 1 : index === 0 ? "👑" : index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>)}</ol></section>

    {message && <div className="toast host-toast" role="status">{message}</div>}
    {party.status !== "ended" && endConfirmOpen && <div className="modal-backdrop end-confirm-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEndConfirmOpen(false)}><section className="end-confirm-card" role="dialog" aria-modal="true" aria-labelledby="end-confirm-title" aria-describedby="end-confirm-description"><p className="eyebrow">🚨 POINT OF NO RETURN</p><h2 id="end-confirm-title">End the party? 🥲</h2><p id="end-confirm-description">This freezes every score and closes the room for new songs and votes. There is no undo.</p><div className="end-confirm-actions"><button ref={cancelEndRef} className="keep-partying" type="button" onClick={() => setEndConfirmOpen(false)}>🎉 Nope, keep partying</button><button className="really-end-party" type="button" disabled={busy} onClick={() => { setEndConfirmOpen(false); void control("end"); }}>{busy ? "⏳ Ending…" : "🏁 Yes, end it forever"}</button></div><small>Press Escape or tap outside to cancel.</small></section></div>}
  </main>;
}
