"use client";

import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

type HostParty = {
  code: string;
  title: string;
  status: "live" | "ended";
  currentTrack: { id: string; title: string; artist: string; duration: string; color: string } | null;
  people: Array<{ id: string; name: string; score: number; initials: string; color: string }>;
  reactions: Array<{ id: string; tone: "up" | "down" }>;
  queueCount: number;
};

type SpotifyPlaybackState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } };
};

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  pause: () => Promise<void>;
  addListener: {
    (event: "ready" | "not_ready", callback: (payload: { device_id: string }) => void): boolean;
    (event: "player_state_changed", callback: (state: SpotifyPlaybackState | null) => void): boolean;
    (event: "autoplay_failed", callback: () => void): boolean;
    (event: "initialization_error" | "authentication_error" | "account_error" | "playback_error", callback: (payload: { message: string }) => void): boolean;
  };
};

type SpotifyConstructor = new (options: {
  name: string;
  getOAuthToken: (callback: (token: string) => void) => void;
  volume?: number;
  enableMediaSession?: boolean;
}) => SpotifyPlayer;

declare global {
  interface Window {
    Spotify?: { Player: SpotifyConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

function spotifyTrackId(value: string) {
  const uriMatch = value.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];
  const legacyMatch = value.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  return legacyMatch?.[1] ?? "";
}

function synthTone(context: AudioContext, frequency: number, endFrequency: number, start: number, duration: number, type: OscillatorType, volume: number) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playSynthReaction(context: AudioContext, kind: "up" | "down") {
  const now = context.currentTime + 0.02;
  if (kind === "up") {
    synthTone(context, 440, 620, now, 0.16, "square", 0.32);
    synthTone(context, 554, 760, now + 0.12, 0.17, "square", 0.3);
    synthTone(context, 659, 990, now + 0.24, 0.28, "triangle", 0.38);
  } else {
    synthTone(context, 190, 72, now, 0.72, "sawtooth", 0.42);
    synthTone(context, 142, 58, now + 0.05, 0.82, "triangle", 0.36);
    synthTone(context, 96, 52, now + 0.12, 0.76, "sine", 0.4);
  }
}

export default function HostRoom({ code }: { code: string }) {
  const [party, setParty] = useState<HostParty | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [hostKey, setHostKey] = useState("");
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
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const audioEnabledRef = useRef(false);
  const reactionAudioContextRef = useRef<AudioContext | null>(null);
  const knownReactions = useRef<Set<string> | null>(null);
  const cancelEndRef = useRef<HTMLButtonElement | null>(null);
  const spotifyPlayerRef = useRef<SpotifyPlayer | null>(null);
  const lastSpotifyTrackRef = useRef("");
  const lastPlaybackStateRef = useRef<SpotifyPlaybackState | null>(null);
  const spotifyEndTimerRef = useRef<number | null>(null);
  const advancingTrackRef = useRef(false);
  const currentSpotifyId = party?.currentTrack ? spotifyTrackId(party.currentTrack.id) : "";

  const getReactionAudioContext = useCallback(() => {
    if (reactionAudioContextRef.current) return reactionAudioContextRef.current;
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    reactionAudioContextRef.current = new AudioContextConstructor();
    return reactionAudioContextRef.current;
  }, []);

  const sayReaction = useCallback((kind: "up" | "down") => {
    if (!audioEnabledRef.current) return;
    const context = getReactionAudioContext();
    if (context) {
      const play = () => playSynthReaction(context, kind);
      if (context.state === "suspended") void context.resume().then(play).catch(() => undefined);
      else play();
    }
    if ("speechSynthesis" in window) {
      const voice = new SpeechSynthesisUtterance(kind === "up" ? "Yeah!" : "Boooo!");
      voice.rate = kind === "up" ? 1.35 : 0.62;
      voice.pitch = kind === "up" ? 1.65 : 0.45;
      voice.volume = 1;
      window.speechSynthesis.speak(voice);
    }
  }, [getReactionAudioContext]);

  useEffect(() => {
    const participant = window.localStorage.getItem(`hackmusic:${code}:participant`) ?? "";
    const key = window.localStorage.getItem(`hackmusic:${code}:host`) ?? "";
    const savedSpotifyClientId = window.localStorage.getItem("hackmusic:spotify:clientId") ?? "";
    const url = `${window.location.origin}/e/${code}`;
    queueMicrotask(() => {
      setParticipantId(participant);
      setHostKey(key);
      setShareUrl(url);
      setSpotifyClientId(savedSpotifyClientId);
      if (!participant || !key) setError("This browser did not create that room, so its host controls are locked.");
    });
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#151515", light: "#fffef9" } }).then(setQrUrl).catch(() => undefined);
  }, [code]);

  useEffect(() => {
    if (!participantId || !hostKey) return;
    let active = true;
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(participantId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (!active) return;
        const nextIds = new Set<string>(data.party.reactions.map((reaction: { id: string }) => reaction.id));
        if (knownReactions.current) {
          data.party.reactions.filter((reaction: { id: string }) => !knownReactions.current?.has(reaction.id)).reverse().forEach((reaction: { tone: "up" | "down" }) => sayReaction(reaction.tone));
        }
        knownReactions.current = nextIds;
        setParty(data.party);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the room."); });
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [code, hostKey, participantId, sayReaction]);

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

  const getSpotifyToken = useCallback(async () => {
    const response = await fetch("/api/spotify/token", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.accessToken) throw new Error(data.error ?? "Spotify is not connected.");
    return data.accessToken as string;
  }, []);

  useEffect(() => {
    if (!participantId || !hostKey) return;
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
            setSpotifyMessage("Spotify Premium is connected. Start the speaker once, then HackMusic takes over.");
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
  }, [code, getSpotifyToken, hostKey, participantId]);

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
    setSpotifyMessage("Full track is playing here. HackMusic will start every next song automatically.");
  }, [getSpotifyToken, spotifyDeviceId]);

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
    const context = getReactionAudioContext();
    if (context) void context.resume().catch(() => undefined);
    audioEnabledRef.current = true;
    setAudioEnabled(true);
    setMessage("Funny sounds are armed. You should hear a quick cheer and boo test now.");
    sayReaction("up");
    window.setTimeout(() => sayReaction("down"), 650);
  }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(shareUrl); setMessage("Invite URL copied."); }
    catch { setMessage("Copy the URL shown below."); }
  }

  async function shareInvite() {
    if (navigator.share) {
      await navigator.share({ title: party?.title ?? "HackMusic", text: `Join HackMusic room ${code}`, url: shareUrl });
    } else {
      await copyInvite();
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
      setSpotifyMessage("Spotify callback URL copied.");
    } catch {
      setSpotifyMessage("Copy the callback URL shown below exactly.");
    }
  }

  async function disconnectSpotify() {
    spotifyPlayerRef.current?.disconnect();
    spotifyPlayerRef.current = null;
    await fetch("/api/spotify/disconnect", { method: "POST" });
    lastSpotifyTrackRef.current = "";
    setSpeakerArmed(false);
    setSpotifyDeviceId("");
    setSpotifyStatus("disconnected");
    setSpotifyMessage("Spotify disconnected from this browser.");
  }

  async function control(action: "skip" | "advance" | "end") {
    setBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, code, participantId, pin: hostKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Host action failed.");
      setParty(data.party);
      setMessage(action === "skip" ? "Skipped. Next secret song!" : action === "advance" ? "Song finished. Next one!" : "Party ended. Scores are final.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Host action failed."); }
    finally { setBusy(false); }
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">HOST KEY REQUIRED</p><h1>{error}</h1><Link href={`/e/${code}`}>Open the participant room →</Link><Link href="/">Create a new room →</Link></main>;
  if (!party) return <main className="loading-room"><span className="brand-mark">HM</span><p>Warming up room {code}…</p></main>;

  const cheers = party.reactions.filter((reaction) => reaction.tone === "up").length;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;
  const spotifyCallbackUrl = shareUrl ? new URL("/api/spotify/callback", shareUrl).toString() : "";
  return <main className="host-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></Link><Link className="participant-link" href={`/e/${code}`}>Open participant page →</Link></header>
    <div className="host-heading"><div><p className="eyebrow">HOST CONTROL · ROOM {party.code}</p><h1>{party.title}</h1></div><span className={`host-status ${party.status}`}>{party.status === "ended" ? "PARTY ENDED" : "LIVE"}</span></div>

    <section className="share-room-card"><div className="share-code"><span>ROOM CODE</span><strong>{party.code}</strong><p>{shareUrl}</p><div><button type="button" onClick={() => void copyInvite()}>Copy invite</button><button type="button" onClick={() => void shareInvite()}>Share</button></div></div>{qrUrl && <Image unoptimized src={qrUrl} width={180} height={180} alt={`QR code to join room ${party.code}`} />}</section>

    <section className={`spotify-connect-card spotify-${spotifyStatus}`}>
      <div className="spotify-connect-heading">
        <div><p className="eyebrow">FULL-TRACK SPEAKER</p><h2>Spotify Premium</h2></div>
        <span>{spotifyStatus === "ready" ? "CONNECTED" : spotifyStatus === "loading" || spotifyStatus === "checking" ? "CHECKING…" : "SETUP NEEDED"}</span>
      </div>
      {spotifyStatus === "ready" ? <div className="spotify-connected-row"><div><strong>This browser is ready to become the speaker.</strong><p>Connect the host phone to your real speaker, then start playback once below.</p></div><button type="button" onClick={() => void disconnectSpotify()}>Disconnect</button></div> : spotifyStatus === "checking" || spotifyStatus === "loading" ? <p className="spotify-loading">Opening the Spotify Web Playback SDK…</p> : <div className="spotify-setup-grid">
        <ol>
          <li><span>1</span><p>Create an app in the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard ↗</a>. Select Web API and Web Playback SDK if asked.</p></li>
          <li><span>2</span><div><p>Add this exact redirect URI in the app settings:</p><code>{spotifyCallbackUrl}</code><button type="button" onClick={() => void copySpotifyCallback()}>Copy callback URL</button></div></li>
          <li><span>3</span><p>Paste the app&apos;s public <strong>Client ID</strong> here. Do not paste its client secret.</p></li>
        </ol>
        <form className="spotify-connect-form" onSubmit={connectSpotify}>
          <label htmlFor="spotify-client-id">SPOTIFY CLIENT ID</label>
          <input id="spotify-client-id" value={spotifyClientId} onChange={(event) => setSpotifyClientId(event.target.value)} placeholder="Paste the public Client ID" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          <button type="submit">Connect Spotify Premium →</button>
        </form>
      </div>}
      {spotifyMessage && <p className="spotify-message" role="status">{spotifyMessage}</p>}
    </section>

    <div className="host-grid"><section className="host-now-card"><div className="section-kicker"><span>ON THE SPEAKER</span><span>{party.queueCount} WAITING</span></div>{party.currentTrack ? <><div className="host-track"><div className={`host-art ${party.currentTrack.color}`}>♪</div><div><h2>{party.currentTrack.title}</h2><p>{party.currentTrack.artist}{party.currentTrack.duration ? ` · ${party.currentTrack.duration}` : ""}</p></div></div>{currentSpotifyId ? <div className={`spotify-host-player spotify-${spotifyStatus}`}><div><strong>SPOTIFY PREMIUM SPEAKER</strong><span>{spotifyStatus === "ready" ? "Full song · no preview limit" : "Connect Spotify above first"}</span></div><button type="button" disabled={spotifyStatus !== "ready" || party.status === "ended"} onClick={() => { enableAudio(); void playSpotifyTrack(currentSpotifyId, true).catch((reason) => setSpotifyMessage(reason instanceof Error ? reason.message : "Could not start Spotify.")); }}>{speakerArmed ? "Play this track again →" : "Start speaker + funny sounds →"}</button><small>Tap once on this host device. Every next secret song will start automatically.</small></div> : <div className="unplayable-track"><strong>This item has no playable Spotify link.</strong><span>Skip it and add a real Spotify track URL.</span></div>}<div className="host-reaction-counts"><div className="host-cheers"><strong>{cheers}</strong><span>CHEERS</span></div><div className="host-boos"><strong>{boos}</strong><span>BOOS</span></div></div></> : <div className="host-empty"><strong>No song yet.</strong><p>Open the participant page and add the first one.</p></div>}</section>
      <section className="host-controls-card"><div className="card-title-row"><h2>CONTROLS</h2><span>THIS PHONE ONLY</span></div><button className={`host-audio ${audioEnabled ? "armed" : ""}`} type="button" onClick={enableAudio}>{audioEnabled ? "✓ Funny sounds armed · tap to test" : "Enable & test funny sounds"}</button><button className="host-skip" type="button" disabled={busy || !party.currentTrack || party.status === "ended"} onClick={() => void control("skip")}>Skip to next song →</button><button className="host-end" type="button" disabled={busy || party.status === "ended"} onClick={() => setEndConfirmOpen(true)}>End party & freeze scores</button>{message && <p className="host-message" role="status">{message}</p>}<p className="host-hint">Reaction sounds play only from this host device. Keep this page open and its volume up.</p></section>
    </div>
    <section className="leaderboard-card"><div className="card-title-row"><h2>{party.status === "ended" ? "FINAL SCOREBOARD" : "LIVE SCOREBOARD"}</h2><span>{party.people.length} PLAYERS</span></div><ol>{[...party.people].sort((a, b) => b.score - a.score).map((person, index) => <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>)}</ol></section>

    {endConfirmOpen && <div className="modal-backdrop end-confirm-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setEndConfirmOpen(false)}><section className="end-confirm-card" role="dialog" aria-modal="true" aria-labelledby="end-confirm-title" aria-describedby="end-confirm-description"><p className="eyebrow">POINT OF NO RETURN</p><h2 id="end-confirm-title">End the party?</h2><p id="end-confirm-description">This freezes every score and closes the room for new songs and votes. There is no undo.</p><div className="end-confirm-actions"><button ref={cancelEndRef} className="keep-partying" type="button" onClick={() => setEndConfirmOpen(false)}>Nope, keep partying</button><button className="really-end-party" type="button" disabled={busy} onClick={() => { setEndConfirmOpen(false); void control("end"); }}>{busy ? "Ending…" : "Yes, end it forever"}</button></div><small>Press Escape or tap outside to cancel.</small></section></div>}
  </main>;
}
