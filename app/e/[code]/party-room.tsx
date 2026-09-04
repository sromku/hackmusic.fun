"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AVATAR_EMOJIS } from "../../../lib/avatar-emojis";
import { artworkVariant, durationSeconds, formatActivityTime, formatMusicDuration, formatPartyStart, mySongStatusLabel, trackSourceLabel, trackWebUrl } from "../../../lib/party-format";
import { extractYouTubeVideoId, youtubeThumbnailUrl } from "../../../lib/youtube-track";
import { FLAIR_EMOJIS, boosNeededToSkip } from "../../../lib/party-fun";
import { MAX_PENDING_TRACKS_PER_PERSON } from "../../../lib/party-rules";
import { isDevelopmentHost } from "../../../lib/dev-only";
import { participantStorageKey, personaDisplayName, personaFromSearch } from "../../../lib/party-storage";
import { shareRecapCard } from "../../../lib/recap-card";
import type { MySong, ParticipantParty, PartyActivity, PartyColor, PartyTrack, RoomSummary } from "../../../lib/party-contract";

function makeFlyaway(emoji: string, x?: number) {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, emoji, x: x ?? 20 + Math.random() * 60 };
}

function Artwork({ tone, seed }: { tone: PartyColor; seed: string }) {
  const videoId = extractYouTubeVideoId(seed);
  if (videoId) return <div className={`album-art youtube-art ${tone}`} role="img" aria-label="YouTube video thumbnail for this song"><Image unoptimized src={youtubeThumbnailUrl(videoId)} width={480} height={360} alt="" /><span className="album-source-badge">▶ YOUTUBE</span></div>;
  return <div className={`album-art ${tone} art-variant-${artworkVariant(seed)}`} role="img" aria-label="Animated geometric artwork generated for this song"><span className="album-circle" /><span className="album-stair" /><span className="album-star">✦</span><span className="album-chaos-dot" /><span className="album-chaos-pill" /><span className="album-chaos-ring" /></div>;
}

export default function PartyRoom({ code }: { code: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [party, setParty] = useState<ParticipantParty | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [showEveryone, setShowEveryone] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState("");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [spotifyHelpOpen, setSpotifyHelpOpen] = useState(false);
  const [youtubeHelpOpen, setYoutubeHelpOpen] = useState(false);
  const [boostArmed, setBoostArmed] = useState(false);
  const [guessBusy, setGuessBusy] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const [flyaways, setFlyaways] = useState<Array<{ id: string; emoji: string; x: number }>>([]);
  const spotifyHelpCloseRef = useRef<HTMLButtonElement>(null);
  const youtubeHelpCloseRef = useRef<HTMLButtonElement>(null);

  const myReaction = party?.reactions.find((reaction) => reaction.mine)?.tone;
  const boos = party?.reactions.filter((reaction) => reaction.tone === "down").length ?? 0;
  const ended = room?.status === "ended" || party?.status === "ended";
  const lobby = room?.status === "lobby" || party?.status === "lobby";
  const hasPlayedSong = (party?.activity ?? []).some((item) => item.tone === "song");
  const latestSongActivityId = [...(party?.activity ?? [])].reverse().find((item) => item.tone === "song")?.id ?? "";
  const boosToSkip = boosNeededToSkip(Boolean(party?.currentTrack?.shielded));
  const visiblePeople = party ? ended ? [...party.people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : showEveryone ? party.people : party.people.slice(0, 4) : [];

  useEffect(() => {
    // Test personas exist only on development hosts; production ignores the parameter entirely.
    const persona = isDevelopmentHost(window.location.hostname) ? personaFromSearch(window.location.search) : "";
    const saved = window.localStorage.getItem(participantStorageKey(code, persona)) ?? "";
    const pendingHandoff = window.sessionStorage.getItem(`hackmusic:${code}:handoff`) ?? "";
    if (persona && !saved) {
      const presetPasscode = new URLSearchParams(window.location.search).get("passcode") ?? "";
      queueMicrotask(() => {
        setJoinName(personaDisplayName(persona));
        if (presetPasscode) setJoinPasscode(presetPasscode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
      });
    }
    if (saved && pendingHandoff) {
      window.sessionStorage.removeItem(`hackmusic:${code}:handoff`);
      window.location.replace(`/e/${code}/host#handoff=${encodeURIComponent(pendingHandoff)}`);
      return;
    }
    if (saved) queueMicrotask(() => setParticipantId(saved));
    fetch(`/api/party?code=${encodeURIComponent(code)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Room not found.");
        setRoom(data.room);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Room not found."));
  }, [code]);

  useEffect(() => {
    if (!participantId) return;
    let active = true;
    let activityHistory: PartyActivity[] = [];
    let activityCursor = "";
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}&activityAfter=${encodeURIComponent(activityCursor)}`, { headers: { "x-hackmusic-participant": participantId } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (active) {
          const incoming = (data.party.activity ?? []) as PartyActivity[];
          if (incoming.length) {
            const known = new Set(activityHistory.map((item) => item.id));
            activityHistory = [...activityHistory, ...incoming.filter((item) => !known.has(item.id))];
            const last = incoming[incoming.length - 1];
            activityCursor = `${last.createdAt}|${last.id}`;
          }
          setParty({ ...data.party, activity: [...activityHistory] });
          setRoom({ code: data.party.code, title: data.party.title, status: data.party.status, scheduledFor: data.party.scheduledFor, requiresPasscode: false, musicSource: data.party.musicSource ?? "spotify" });
        }
      })
      .catch((reason) => { if (active && String(reason).includes("Join this room")) setParticipantId(""); });
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [code, participantId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!spotifyHelpOpen && !youtubeHelpOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSpotifyHelpOpen(false);
        setYoutubeHelpOpen(false);
      }
    };
    window.queueMicrotask(() => (youtubeHelpOpen ? youtubeHelpCloseRef : spotifyHelpCloseRef).current?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [spotifyHelpOpen, youtubeHelpOpen]);

  async function postAction(payload: Record<string, unknown>) {
    if (!participantId) throw new Error("Join the room first.");
    const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, participantId, ...payload }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data as { party: ParticipantParty; skipped?: boolean; shieldAbsorbed?: boolean; boosted?: boolean; submittedTrack?: PartyTrack };
  }

  function buzz(pattern: number | number[] = 30) {
    try { navigator.vibrate?.(pattern); } catch { /* haptics are optional */ }
  }

  function flyAway(emoji: string, x?: number) {
    const item = makeFlyaway(emoji, x);
    setFlyaways((current) => [...current.slice(-14), item]);
    window.setTimeout(() => setFlyaways((current) => current.filter((entry) => entry.id !== item.id)), 1_600);
  }

  async function sendFlair(emoji: string) {
    flyAway(emoji);
    buzz(15);
    try {
      const data = await postAction({ action: "flair", emoji });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That emoji got lost on the way to the host screen.");
    }
  }

  async function shieldMySong() {
    if (busy) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "shield" });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      buzz([20, 40, 20]);
      flyAway("🛡️", 50);
      setNotice(`🛡️ Shield up! Your song now needs ${boosNeededToSkip(true)} boos, and the first boo costs nothing.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "The shield did not activate.");
    } finally {
      setBusy(false);
    }
  }

  async function guessPicker(publicId: string, name: string) {
    if (guessBusy) return;
    setGuessBusy(true);
    try {
      const data = await postAction({ action: "guess", guessParticipantId: publicId });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      buzz(15);
      setNotice(`🕵️ Guess locked on ${name}. +2 if you are right. You can change it until the song ends.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Your guess did not go through.");
    } finally {
      setGuessBusy(false);
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
        people: [...party.people].sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).map((person) => ({ name: person.name === "You" ? party.viewerDisplayName : person.name, avatar: person.initials, score: person.score ?? 0 })),
        awards: party.awards ?? [],
        songsPlayed: party.recap?.songsPlayed ?? 0,
        songsBooedOff: party.recap?.songsBooedOff ?? 0,
        reactions: party.recap?.reactions ?? 0,
      });
      setNotice(delivered === "shared" ? "📸 Recap card shared." : "📸 Recap card saved to your downloads.");
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setNotice(reason instanceof Error ? reason.message : "The recap card could not be created.");
    } finally {
      setRecapBusy(false);
    }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinName.trim().length < 2) { setNotice("👋 Your name needs at least two letters."); return; }
    setBusy(true);
    const id = `p-${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", code, participantId: id, name: joinName, passcode: joinPasscode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not join.");
      window.localStorage.setItem(participantStorageKey(code, isDevelopmentHost(window.location.hostname) ? personaFromSearch(window.location.search) : ""), id);
      const pendingHandoff = window.sessionStorage.getItem(`hackmusic:${code}:handoff`) ?? "";
      if (pendingHandoff) {
        window.sessionStorage.removeItem(`hackmusic:${code}:handoff`);
        window.location.assign(`/e/${code}/host#handoff=${encodeURIComponent(pendingHandoff)}`);
        return;
      }
      setParticipantId(id);
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setNotice(`🥳 You’re in, ${joinName.trim()}!`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not join."); }
    finally { setBusy(false); }
  }

  async function react(kind: "up" | "down") {
    if (busy || myReaction || !party?.currentTrack) return;
    setBusy(true);
    const boost = kind === "up" && boostArmed;
    flyAway(kind === "up" ? (boost ? "⚡" : "🙌") : "👻", kind === "up" ? 28 : 72);
    buzz(kind === "up" ? (boost ? [30, 40, 60] : 30) : [20, 30, 20]);
    try {
      const data = await postAction({ action: "react", kind, boost });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setBoostArmed(false);
      setNotice(data.skipped
        ? "⏭️ The crowd pulled the plug! Next song!"
        : data.boosted
          ? "⚡ DOUBLE CHEER! +6 to the picker. Your power-up is spent."
          : data.shieldAbsorbed
            ? "🛡️ That song is shielded. Your boo cost 0 points, and it takes 4 boos to skip."
            : kind === "up" ? "🙌 Cheer locked in! +3 to the picker." : "👻 Anonymous boo locked in.");
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Reaction failed."); }
    finally { setBusy(false); }
  }

  async function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("song-link") ?? "").trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "submit", trackUrl: value });
      if (!data.submittedTrack) throw new Error("The music service did not confirm that track.");
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setAddOpen(false);
      setNotice(`🤫🎵 ${data.submittedTrack.title} is secretly in the mix.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Song could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSong(song: MySong) {
    if (busy || song.status !== "pending") return;
    setBusy(true);
    try {
      const data = await postAction({ action: "remove", submissionId: song.queueId });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setRemoveConfirmId("");
      setNotice(`🫥 ${song.title} vanished from your queue.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Song could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeAvatar(emoji: string) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "avatar", avatarEmoji: emoji });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setAvatarOpen(false);
      setNotice(`${emoji} Party face unlocked. Looking dangerously iconic.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Your party face escaped. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openNameEditor() {
    setNameDraft(party?.viewerDisplayName ?? "");
    setNameOpen(true);
  }

  async function changeName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = nameDraft.trim();
    if (busy) return;
    if (nextName.length < 2 || nextName.length > 24) {
      setNotice("🎟️ Use a party name between 2 and 24 characters.");
      return;
    }
    if (nextName === party?.viewerDisplayName) {
      setNameOpen(false);
      return;
    }
    setBusy(true);
    try {
      const data = await postAction({ action: "profileName", name: nextName });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setNameOpen(false);
      setNotice(`🎤 You are now ${data.party.viewerDisplayName}. Identity remixed.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Your party name refused to cooperate. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function surpriseAvatar() {
    const alternatives = AVATAR_EMOJIS.filter((option) => option.emoji !== party?.viewer.initials);
    const choice = alternatives[Math.floor(Math.random() * alternatives.length)] ?? AVATAR_EMOJIS[0];
    void changeAvatar(choice.emoji);
  }

  function closeSpotifyHelp() {
    setSpotifyHelpOpen(false);
    window.setTimeout(() => document.getElementById("song-link")?.focus(), 0);
  }

  function closeYoutubeHelp() {
    setYoutubeHelpOpen(false);
    window.setTimeout(() => document.getElementById("song-link")?.focus(), 0);
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">ROOM LOST</p><h1>{error}</h1><a href="/">Try another code →</a></main>;
  if (!room) return <main className="loading-room"><span className="brand-mark">HM</span><p>Finding room {code}…</p></main>;
  const roomIsYouTube = (party?.musicSource ?? room.musicSource) === "youtube";
  const currentTrackUrl = party?.currentTrack ? trackWebUrl(party.currentTrack.id) : "";
  const currentTrackIsYouTube = Boolean(party?.currentTrack && trackSourceLabel(party.currentTrack.id) === "YouTube");
  const waitingSongs = party?.mySongs.filter((song) => song.status === "pending") ?? [];
  const submittedHistory = party?.mySongs.filter((song) => song.status !== "pending" && song.status !== "removed") ?? [];
  const myMusicSeconds = party?.mySongs.reduce((total, song) => total + durationSeconds(song.duration), 0) ?? 0;

  return (
    <main className="party-shell">
      <div className="shape shape-one" aria-hidden="true" /><div className="shape shape-two" aria-hidden="true" /><div className="shape shape-three" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic</span></a>
        <div className={`room-pill ${lobby ? "lobby" : ""}`}><span className={`live-dot ${ended ? "ended" : lobby ? "lobby" : ""}`} /> {ended ? "🏁 ENDED" : lobby ? "🌙 LOBBY OPEN" : "⚡ LIVE"} · ROOM {room.code}</div>
      </header>
      <section className="event-heading" id="top">
        <div><p className="eyebrow">{ended ? "🏆 FINAL SCORES ARE IN" : lobby ? "🎵 THE QUEUE IS WARMING UP" : "👂 THE ROOM IS LISTENING"}</p><h1>{room.title}</h1></div>
        {!ended && party && <button className="add-song-button" type="button" onClick={() => setAddOpen(true)}><span aria-hidden="true">🎵</span> Add a song</button>}
      </section>

      {party && !ended && party.theme && <section className="theme-banner" role="status"><span>🎯 ROUND THEME</span><strong dir="auto">{party.theme}</strong><small>Set by the host. Pick accordingly, or rebel loudly.</small></section>}
      {party && ended && <section className="ended-banner"><strong>🏁 THAT’S A WRAP.</strong><span>🏆 No more votes. Bragging may continue indefinitely.</span><button type="button" className="recap-share" onClick={() => void shareRecap()} disabled={recapBusy}>{recapBusy ? "📸 Drawing…" : "📸 Share the recap card"}</button></section>}
      {party && ended && party.awards && party.awards.length > 0 && <section className="awards-card" aria-labelledby="awards-title"><div className="card-title-row"><h2 id="awards-title">🎖️ PARTY AWARDS</h2><span>{party.awards.length} {party.awards.length === 1 ? "TROPHY" : "TROPHIES"}</span></div><div className="awards-grid">{party.awards.map((entry) => <article className={`award ${entry.winnerName === "You" ? "mine" : ""}`} key={entry.id}><span className="award-emoji" aria-hidden="true">{entry.emoji}</span><div><strong>{entry.title}</strong><p><span className={`avatar ${entry.winnerColor}`}>{entry.winnerAvatar}</span> <b>{entry.winnerName}</b></p><small>{entry.detail}</small></div></article>)}</div></section>}
      {party && lobby && <section className="lobby-banner"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY</p><strong>Build the secret queue before the speakers wake up.</strong><span>Expected start: {formatPartyStart(party.scheduledFor)}. The host decides the exact moment.</span></div><div className="lobby-count"><strong>{party.queueCount}</strong><span>{party.queueCount === 1 ? "SECRET SONG" : "SECRET SONGS"}</span></div></section>}

      {party && <div className="party-grid">
        <section className={`now-playing ${!party.currentTrack ? "empty-player" : ""}`} aria-labelledby="playing-title">
          <div className="section-kicker"><span>{ended ? party.currentTrack ? "📼 FINAL SONG" : "🏁 SPEAKER RETIRED" : party.currentTrack ? "🎵 NOW PLAYING" : lobby ? "🌙 PLAYBACK STARTS LATER" : "🔇 THE SPEAKER IS WAITING"}</span><span>{ended ? `📦 ${party.queueCount} LEFT UNPLAYED` : `🤫 ${party.queueCount} SECRETLY QUEUED`}</span></div>
          {party.currentTrack ? <>
            <div className="track-card"><Artwork tone={party.currentTrack.color} seed={party.currentTrack.id} /><div className="track-copy"><p className="track-label">{ended ? "🏁 FINAL CHAOS" : "⚡ CURRENT CHAOS"}{party.currentTrack.shielded && <b className="shield-badge">🛡️ SHIELDED · {boosToSkip} BOOS TO SKIP</b>}</p><h2 id="playing-title">{party.currentTrack.title}</h2><div className="track-meta-row"><p className="artist">🎤 {party.currentTrack.artist}</p>{currentTrackUrl && <a className={`spotify-save-link ${currentTrackIsYouTube ? "youtube-open-link" : ""}`} href={currentTrackUrl} target="_blank" rel="noreferrer" aria-label={`Open ${party.currentTrack.title} by ${party.currentTrack.artist} on ${currentTrackIsYouTube ? "YouTube" : "Spotify"}`}>{currentTrackIsYouTube ? "▶ Open on YouTube ↗" : "＋ Add to my Spotify ↗"}</a>}</div><p className="submitted">🕵️ Submitted by a mystery human</p>{!ended && party.powerUps.shieldUsableNow && <button className="shield-button" type="button" onClick={() => void shieldMySong()} disabled={busy}>🛡️ Shield my song · once per party</button>}</div></div>
            {!ended && <div className="reaction-panel"><div className="reaction-actions">
              <button className={`reaction-button cheer ${myReaction === "up" ? "selected" : ""}`} type="button" onClick={() => void react("up")} disabled={busy || Boolean(myReaction)} aria-pressed={myReaction === "up"}><span className="reaction-icon" aria-hidden="true">🙌</span><span><strong>CHEER</strong><small>{myReaction === "up" ? "locked in" : myReaction ? "vote already locked" : "make some noise"}</small></span>{myReaction === "up" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
              <button className={`reaction-button boo ${myReaction === "down" ? "selected" : ""}`} type="button" onClick={() => void react("down")} disabled={busy || Boolean(myReaction)} aria-pressed={myReaction === "down"}><span className="reaction-icon" aria-hidden="true">👻</span><span><strong>BOO</strong><small>{myReaction === "down" ? "locked anonymously" : myReaction ? "vote already locked" : "3 boos skip it"}</small></span>{myReaction === "down" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
            </div>{!myReaction && party.powerUps.boostAvailable && <button className={`boost-toggle ${boostArmed ? "armed" : ""}`} type="button" aria-pressed={boostArmed} onClick={() => setBoostArmed((value) => !value)}>{boostArmed ? "⚡ Double cheer armed · your next cheer is worth +6" : "⚡ Arm my double cheer · +6, once per party"}</button>}{myReaction && <div className="reaction-choice-note" role="status"><strong>{myReaction === "up" ? "🙌 You cheered" : "👻 You booed anonymously"}</strong><span>Vote locked for this song. No take-backs.</span></div>}<div className="boo-meter"><span className="boo-count">{boos}</span><div><strong>{boos === 0 ? "👻 NO BOOS YET" : boos >= boosToSkip - 1 ? "😬 ONE BOO TO GO" : boos === 1 ? "👻 ONE BOO IN" : `👻 ${boos} BOOS IN`}</strong><small>{Math.max(0, boosToSkip - boos)} more and it’s gone.</small></div><div className="meter-pips" aria-label={`${boos} of ${boosToSkip} boos`}>{Array.from({ length: boosToSkip }, (_, index) => <i className={index < boos ? "filled" : ""} key={index} />)}</div></div><div className="flair-bar" role="group" aria-label="Quick emoji reactions for the host screen">{FLAIR_EMOJIS.map((emoji) => <button type="button" onClick={() => void sendFlair(emoji)} key={emoji} aria-label={`Send ${emoji} to the host screen`}>{emoji}</button>)}<small>Unscored. Lands on the host screen.</small></div>{party.guessOptions.length > 0 && <div className="guess-card"><div><strong>🕵️ Who picked this one?</strong><small>+2 points if you are right. Change your mind until the song ends.</small></div><div className="guess-chips">{party.guessOptions.map((person) => <button className={party.myGuess === person.id ? "selected" : ""} type="button" aria-pressed={party.myGuess === person.id} disabled={guessBusy} onClick={() => void guessPicker(person.id, person.name)} key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><span>{person.name}</span></button>)}</div></div>}</div>}
          </> : <div className="empty-player-copy"><span>{ended ? "🏁" : lobby ? "🤫" : hasPlayedSong ? "🎚️" : "🦗"}</span><h2 id="playing-title">{ended ? "The room has spoken." : lobby ? "The queue is undercover." : hasPlayedSong ? "The last song left the chat." : "Silence has entered the chat."}</h2><p>{ended ? "🏆 Final scores are frozen. The music stopped; the bragging did not." : lobby ? "🎵 Add secret songs now. Reactions unlock when the host starts the party." : hasPlayedSong ? "🎵 That song finished. Add another secret song and keep the speaker employed." : "🎵 Add the first song and the room starts immediately."}</p>{!ended && <button type="button" onClick={() => setAddOpen(true)}>{lobby ? "🤫 Add a secret song →" : hasPlayedSong ? "🎶 Add another song →" : "🎶 Add the first song →"}</button>}</div>}
        </section>

        <aside className={`party-sidebar ${ended ? "scores-revealed" : "scores-hidden"}`}>{ended && <section className="sidebar-card score-card"><div className="score-topline"><span>🏆 YOUR FINAL SCORE</span><span>⭐</span></div><strong className="big-score">{party.viewer.score ?? "—"}</strong><p>🧊 Frozen forever. Brag responsibly.</p></section>}
          <section className="sidebar-card crowd-card">
            <div className="card-title-row"><h2>{ended ? "🏆 FINAL SCORES" : "🪩 THE CROWD"}</h2><span>{ended ? "👀 REVEALED" : `🎉 ${party.people.length} HERE`}</span></div>
            <div className="party-identity-actions">
              <button className="party-avatar-trigger" type="button" onClick={() => setAvatarOpen(true)}><span className={`avatar ${party.viewer.color}`}>{party.viewer.initials}</span><span><small>YOUR PARTY FACE</small><strong>Tap to unleash an emoji</strong></span><b>CHANGE →</b></button>
              <button className="party-name-trigger" type="button" onClick={openNameEditor}><span aria-hidden="true">✎</span><span><small>YOUR PARTY NAME</small><strong>{party.viewerDisplayName}</strong></span><b>EDIT →</b></button>
            </div>
            <div className="people-list">{visiblePeople.map((person) => <div className="person-row" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}</strong>{ended && <span className="person-score">{person.score ?? "—"}</span>}</div>)}</div>{!ended && party.people.length > 4 && <button className="text-button" type="button" onClick={() => setShowEveryone((value) => !value)}>{showEveryone ? "Show less ↑" : "Show everybody →"}</button>}
          </section>
        </aside>
      </div>}

      {party && !ended && party.lastSong && <section className="reveal-card" aria-labelledby="reveal-title"><div className="reveal-topline"><p className="eyebrow">📼 LAST SONG · MYSTERY SOLVED</p><b className={`song-outcome ${party.lastSong.status === "played" ? "played" : party.lastSong.skipReason === "boos" ? "boos" : "host"}`}>{party.lastSong.status === "played" ? "✅ PLAYED TO THE END" : party.lastSong.skipReason === "boos" ? `🪦 BOOED OFF${party.lastSong.skipPercent === null ? "" : ` AT ${party.lastSong.skipPercent}%`}` : "⏭️ SKIPPED BY HOST"}</b></div><h2 id="reveal-title" dir="auto">{party.lastSong.title}</h2><p className="reveal-artist" dir="auto">🎤 {party.lastSong.artist}</p><div className="reveal-picker"><span className={`avatar ${party.lastSong.submitterColor}`}>{party.lastSong.submitterAvatar}</span><div><small>PICKED BY</small><strong>{party.lastSong.submittedBy}</strong></div><div className="reveal-guesses"><small>DETECTIVES</small><strong>{party.lastSong.totalGuesses ? `${party.lastSong.correctGuesses} of ${party.lastSong.totalGuesses} guessed right` : "Nobody dared to guess"}</strong></div></div>{party.lastSong.myGuessCorrect !== null && <p className={`reveal-my-guess ${party.lastSong.myGuessCorrect ? "right" : "wrong"}`}>{party.lastSong.myGuessCorrect ? "🕵️ You guessed right. +2 points, detective." : "🙈 You guessed wrong. The mystery human wins this round."}</p>}{party.lastSong.mine && <p className="reveal-my-guess mine">🫵 That was your song. Everyone knows now.</p>}</section>}
      {party && <section className="activity-card"><div className="card-title-row"><h2>🔊 ROOM NOISE</h2><span>📜 FULL PARTY HISTORY</span></div><div className="activity-list" role="log" aria-live="polite" aria-label="Scrollable history of songs and reactions since the party began">{[...(party.activity ?? [])].reverse().map((item) => { const nowPlaying = item.tone === "song" && item.id === latestSongActivityId && Boolean(party.currentTrack) && !ended; return <div className={`activity-row ${item.tone}${item.tone === "song" ? (nowPlaying ? " song-start" : " song-past") : ""}`} key={item.id}><span className="activity-avatar">{item.tone === "song" && !nowPlaying ? "📼" : item.avatar}</span>{item.tone === "song" ? <p><strong>{nowPlaying ? "🎶 Now playing:" : "📼 Played earlier:"}</strong> <span dir="auto">{item.trackTitle}</span></p> : <p><span className="activity-emoji" aria-hidden="true">{item.tone === "up" ? "🎉" : "👻"}</span> <strong>{item.name}</strong> {item.message} <b dir="auto">“{item.trackTitle}”</b></p>}<span className="activity-icon" aria-hidden="true">{item.tone === "song" && !nowPlaying ? "✔" : item.icon}</span><time dateTime={item.createdAt}>{formatActivityTime(item.createdAt)}</time></div>; })}{!(party.activity ?? []).length && <p className="quiet-feed">{ended ? "📼 A remarkably peaceful party. No songs or reactions made the history book." : "🦗 It’s suspiciously quiet in here… The full story will appear here."}</p>}</div><p className="activity-scroll-hint">↕️ Scroll through the history. At either end, keep scrolling to continue through the page.</p></section>}

      {party && <section className="my-music-card" aria-labelledby="my-music-title">
        <div className="my-music-heading"><div><p className="eyebrow">🔐 PRIVATE TO THIS BROWSER</p><h2 id="my-music-title">🎧 My music</h2></div><div className="my-music-heading-copy"><p>Your picks and your reactions. Nobody else gets this backstage pass.</p><strong className="my-music-total"><span>⏱️ TOTAL MUSIC EVER ADDED</span>{formatMusicDuration(myMusicSeconds)}</strong></div></div>
        <div className="my-music-grid">
          <article className="my-music-column my-queue-column">
            <div className="my-column-title"><div><span>{ended ? "📦" : "🤫"}</span><div><h3>{ended ? "Left in my queue" : "Still in my queue"}</h3><p>{ended ? "The party ended before these escaped." : "The room still hides when they’ll play."}</p></div></div><b>{waitingSongs.length}</b></div>
            <div className="my-track-list">{waitingSongs.map((song) => <div className="my-track-row" key={song.queueId}>
              <span className={`my-track-art ${song.color}`} aria-hidden="true">{trackSourceLabel(song.id) === "YouTube" ? "▶" : "♪"}</span>
              <div className="my-track-copy"><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist} · {song.duration}</span><small>{mySongStatusLabel(song, ended)}</small></div>
              {!ended && (removeConfirmId === song.queueId ? <div className="remove-confirm" aria-label={`Confirm removal of ${song.title}`}><button type="button" onClick={() => setRemoveConfirmId("")} disabled={busy}>Keep</button><button className="remove-now" type="button" onClick={() => void removeSong(song)} disabled={busy}>{busy ? "Removing…" : "Remove"}</button></div> : <button className="remove-song-button" type="button" onClick={() => setRemoveConfirmId(song.queueId)} disabled={busy} aria-label={`Remove ${song.title} from your queue`}>Remove</button>)}
            </div>)}{waitingSongs.length === 0 && <p className="my-music-empty">{ended ? "📭 Nothing was stranded. Clean exit." : "🕳️ No secret picks waiting. Suspicious."}</p>}</div>
          </article>

          <article className="my-music-column">
            <div className="my-column-title"><div><span>📼</span><div><h3>My played songs</h3><p>What happened to the songs you smuggled in.</p></div></div><b>{submittedHistory.length}</b></div>
            <div className="my-track-list">{submittedHistory.map((song) => <a className="my-track-row my-track-link" href={trackWebUrl(song.id)} target="_blank" rel="noreferrer" key={song.queueId}>
              <span className={`my-track-art ${song.color}`} aria-hidden="true">{trackSourceLabel(song.id) === "YouTube" ? "▶" : "♪"}</span><span className="my-track-copy"><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist} · {song.duration}</span><small>{mySongStatusLabel(song, ended)}</small></span><span className="my-track-arrow" aria-hidden="true">↗</span>
            </a>)}{submittedHistory.length === 0 && <p className="my-music-empty">🎚️ Your songs have not reached the speaker yet.</p>}</div>
          </article>

          <article className="my-music-column my-reactions-column">
            <div className="my-column-title"><div><span>🫣</span><div><h3>My reactions</h3><p>Your cheers—and your privately remembered boos.</p></div></div><b>{party.myReactionHistory.length}</b></div>
            <div className="my-track-list">{party.myReactionHistory.map((reaction) => <a className={`my-track-row my-track-link my-reaction-history ${reaction.tone}`} href={trackWebUrl(reaction.id)} target="_blank" rel="noreferrer" key={reaction.reactionId}>
              <span className="my-reaction-mark" aria-hidden="true">{reaction.tone === "up" ? "🙌" : "👻"}</span><span className="my-track-copy"><strong dir="auto">{reaction.title}</strong><span dir="auto">{reaction.artist}</span><small>{reaction.tone === "up" ? "You cheered" : "You booed anonymously"} · {mySongStatusLabel({ status: reaction.songStatus, skipReason: reaction.skipReason, skipPercent: reaction.skipPercent }, ended)}</small></span><span className="my-track-arrow" aria-hidden="true">↗</span>
            </a>)}{party.myReactionHistory.length === 0 && <p className="my-music-empty">🧘 No opinions recorded. Astonishing restraint.</p>}</div>
          </article>
        </div>
      </section>}

      {!ended && addOpen && party && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          setSpotifyHelpOpen(false);
          setYoutubeHelpOpen(false);
          setAddOpen(false);
        }
      }}><section className="song-modal spotify-song-modal" role="dialog" aria-modal="true" aria-hidden={spotifyHelpOpen || youtubeHelpOpen || undefined} aria-labelledby="add-song-title"><div className="modal-topline"><div><p className="eyebrow">🤫 SECRET WEAPON</p><h2 id="add-song-title">{roomIsYouTube ? "▶️ Add a YouTube video" : "🎵 Add a Spotify song"}</h2></div><button className="close-button" type="button" onClick={() => {
        setSpotifyHelpOpen(false);
        setYoutubeHelpOpen(false);
        setAddOpen(false);
      }} aria-label="Close">×</button></div>{party.theme && <p className="theme-hint">🎯 Round theme: <strong dir="auto">{party.theme}</strong></p>}<div className="spotify-add-guide"><div><strong>{roomIsYouTube ? "▶️ YouTube → Share → Copy link" : "🟢 Spotify → Share → Copy song link"}</strong><span>{roomIsYouTube ? "This room plays YouTube only. Paste the video link below; its title is checked before it joins the secret queue." : "This room plays Spotify only. Paste the track below; its title is checked before it joins the secret queue."}</span></div><button className="spotify-how-button" type="button" aria-haspopup="dialog" onClick={() => roomIsYouTube ? setYoutubeHelpOpen(true) : setSpotifyHelpOpen(true)}>🤔 Show me how</button></div><form className="link-form spotify-link-form" onSubmit={(event) => void submitLink(event)}><label htmlFor="song-link">{roomIsYouTube ? "YOUTUBE VIDEO LINK" : "SPOTIFY TRACK LINK"}</label><input id="song-link" name="song-link" type="url" inputMode="url" autoComplete="off" placeholder={roomIsYouTube ? "Paste a YouTube video link…" : "Paste a full track or short /s/ link…"} required /><button type="submit" disabled={busy || party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON}>{busy ? "🔎 Checking the link…" : party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON ? "🚧 Your waiting queue is full" : "🤫 Add to the secret queue →"}</button></form><p className="queue-note">🕵️ The queue stays secret. You have {Math.max(0, MAX_PENDING_TRACKS_PER_PERSON - party.pendingCount)} of {MAX_PENDING_TRACKS_PER_PERSON} waiting slots left. Played and skipped songs free their slots.</p></section></div>}

      {spotifyHelpOpen && <div className="modal-backdrop spotify-help-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && closeSpotifyHelp()}><section className="spotify-help-card" role="dialog" aria-modal="true" aria-labelledby="spotify-help-title"><div className="modal-topline"><div><p className="eyebrow">🟢 THREE TAPS · ZERO DJ DEGREE</p><h2 id="spotify-help-title">Borrow the link. Keep the chaos.</h2></div><button className="close-button" type="button" onClick={closeSpotifyHelp} aria-label="Close Spotify instructions" ref={spotifyHelpCloseRef}>×</button></div><p className="spotify-help-intro">Spotify buried the useful button under a tiny menu. Naturally. Here is the escape route.</p><div className="spotify-help-steps">
        <article className="spotify-help-step step-song"><div className="spotify-step-top"><span>01</span><strong>Find the actual song</strong></div><div className="spotify-mini-screen spotify-song-screen" aria-hidden="true"><div className="mini-spotify-bar"><b>●</b><span>SPOTIFY</span></div><div className="mini-song-row"><i>♪</i><span><strong>Your excellent song</strong><small>Mystery artist</small></span><b>•••</b></div><em>tap the dots ↗</em></div><p>Open the song itself, then tap the <strong>•••</strong> menu. A playlist link is not invited to this party.</p></article>
        <article className="spotify-help-step step-share"><div className="spotify-step-top"><span>02</span><strong>Tap Share</strong></div><div className="spotify-mini-screen spotify-menu-screen" aria-hidden="true"><i /><div><span>↗</span><strong>Share</strong></div><div className="menu-ghost"><span>＋</span><b>Add to playlist</b></div></div><p>Scroll the song menu if needed. Find <strong>Share</strong>. It is usually pretending not to be important.</p></article>
        <article className="spotify-help-step step-copy"><div className="spotify-step-top"><span>03</span><strong>Copy the link</strong></div><div className="spotify-mini-screen spotify-share-screen" aria-hidden="true"><div className="share-bubbles"><i>↗</i><i>💬</i><i>⋯</i></div><div className="copy-link-tile"><span>🔗</span><strong>Copy link</strong></div></div><p>Tap <strong>Copy link</strong>, return here, and paste. Full links and short <strong>/s/</strong> links both work.</p></article>
      </div><div className="spotify-help-finish"><span>🎉</span><div><strong>That’s it. Your song enters anonymously.</strong><small>Nobody sees the queue. Your suspiciously specific taste remains a surprise.</small></div><button type="button" onClick={closeSpotifyHelp}>I found the link →</button></div></section></div>}

      {youtubeHelpOpen && <div className="modal-backdrop spotify-help-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && closeYoutubeHelp()}><section className="spotify-help-card youtube-help-card" role="dialog" aria-modal="true" aria-labelledby="youtube-help-title"><div className="modal-topline"><div><p className="eyebrow">▶️ THREE TAPS · ZERO SUBSCRIPTIONS</p><h2 id="youtube-help-title">Steal the link. Keep the mystery.</h2></div><button className="close-button" type="button" onClick={closeYoutubeHelp} aria-label="Close YouTube instructions" ref={youtubeHelpCloseRef}>×</button></div><p className="spotify-help-intro">YouTube hides nothing; it just surrounds the useful button with nine others. Here is the shortest path.</p><div className="spotify-help-steps youtube-help-steps">
        <article className="spotify-help-step step-song"><div className="spotify-step-top"><span>01</span><strong>Open the actual video</strong></div><div className="spotify-mini-screen youtube-video-screen" aria-hidden="true"><div className="mini-youtube-bar"><b>▶</b><span>YouTube</span></div><div className="mini-video"><i>▶</i></div><div className="mini-video-title"><strong>Your excellent video</strong><small>Mystery channel · 2.3M views</small></div><div className="mini-video-actions"><span>👍</span><span>👎</span><em>↗ Share</em><span>⤓</span></div></div><p>Tap the video so it is playing, not just sitting in a feed. A playlist link is not invited; a Short is fine.</p></article>
        <article className="spotify-help-step step-share"><div className="spotify-step-top"><span>02</span><strong>Tap Share</strong></div><div className="spotify-mini-screen youtube-share-screen" aria-hidden="true"><i /><div className="youtube-share-row"><span>🔗</span><strong>Copy link</strong></div><div className="youtube-share-apps"><b>💬</b><b>✉️</b><b>📋</b><b>⋯</b></div></div><p>Find <strong>Share</strong> under the video. The share sheet opens with <strong>Copy link</strong> front and center. Ignore the 14 apps pretending to be helpful.</p></article>
        <article className="spotify-help-step step-copy"><div className="spotify-step-top"><span>03</span><strong>Paste it here</strong></div><div className="spotify-mini-screen youtube-paste-screen" aria-hidden="true"><div className="mini-paste-field"><span>youtu.be/dQw4…</span></div><div className="mini-paste-button">🤫 Add to the secret queue →</div></div><p>Come back and paste. Long links, <strong>youtu.be</strong> links, and Shorts all work. We even tolerate the tracking junk after the <strong>?</strong>.</p></article>
      </div><div className="spotify-help-finish youtube-help-finish"><span>🎬</span><div><strong>That’s it. The video plays on the host screen.</strong><small>Nobody sees the queue. Your questionable taste stays classified until it plays.</small></div><button type="button" onClick={closeYoutubeHelp}>I found the link →</button></div></section></div>}

      {avatarOpen && party && <div className="modal-backdrop avatar-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAvatarOpen(false)}><section className="avatar-picker-card" role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title"><div className="modal-topline"><div><p className="eyebrow">🎭 IDENTITY, BUT LOUDER</p><h2 id="avatar-picker-title">Pick your party face</h2></div><button className="close-button" type="button" onClick={() => setAvatarOpen(false)} aria-label="Close avatar picker">×</button></div><p className="avatar-picker-intro">Choose wisely. This tiny face will represent your enormous musical opinions.</p><div className="avatar-grid" role="group" aria-label="Party face emojis">{AVATAR_EMOJIS.map((option) => <button className={party.viewer.initials === option.emoji ? "selected" : ""} type="button" onClick={() => void changeAvatar(option.emoji)} disabled={busy} aria-label={`Use ${option.label} as my party face`} aria-pressed={party.viewer.initials === option.emoji} key={option.emoji}><span aria-hidden="true">{option.emoji}</span><small>{option.label}</small></button>)}</div><button className="avatar-surprise" type="button" onClick={surpriseAvatar} disabled={busy}>{busy ? "✨ Summoning chaos…" : "🎲 Surprise me, algorithm →"}</button><p className="avatar-privacy-note">🔐 Only your avatar changes. Your anonymous boos remain delightfully anonymous.</p></section></div>}

      {nameOpen && party && <div className="modal-backdrop name-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setNameOpen(false)}><form className="name-picker-card" role="dialog" aria-modal="true" aria-labelledby="name-picker-title" onSubmit={(event) => void changeName(event)}><div className="modal-topline"><div><p className="eyebrow">🎤 WITNESS PROTECTION, BUT FESTIVE</p><h2 id="name-picker-title">Rename your human</h2></div><button className="close-button" type="button" onClick={() => setNameOpen(false)} aria-label="Close name editor">×</button></div><p className="name-picker-intro">New nickname, same suspicious music taste. Everyone in this room will see the update.</p><label htmlFor="party-name-edit">YOUR NEW PARTY NAME</label><input id="party-name-edit" value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} minLength={2} maxLength={24} autoComplete="nickname" autoFocus required /><div className="name-picker-count"><span>Keep it recognizable-ish.</span><b>{nameDraft.length}/24</b></div><button className="name-save-button" type="submit" disabled={busy}>{busy ? "🎛️ Remixing identity…" : "✨ Save my new legend →"}</button><p className="avatar-privacy-note">👻 Your boos remain anonymous. Even from your new identity.</p></form></div>}

      {!participantId && !ended && <div className="modal-backdrop join-backdrop"><form className="join-card" onSubmit={join}><span className="join-mark">HM</span><p className="eyebrow">🎟️ ROOM {room.code}</p><h2>{lobby ? "The pre-party is open 🌙" : "Who just walked in? 👀"}</h2><p>You’re joining <strong>{room.title}</strong>. {lobby ? "Tell the room what to call you, then start hiding songs in the queue." : "Tell the room what to call you, then collect your 30 points ⭐"}</p><label htmlFor="join-name">YOUR NAME — SHOWN TO EVERYONE</label><input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} autoComplete="nickname" placeholder="Type your name or nickname (e.g. Maya)" required /><small className="join-name-hint">👋 This is how other humans will see you. It is not the room code.</small><small className="join-source-hint">{room.musicSource === "youtube" ? "▶️ This room plays YouTube videos. Have your video links ready." : "🟢 This room plays Spotify tracks. Have your song links ready."}</small>{room.requiresPasscode && <><label htmlFor="join-passcode">ROOM PASSCODE — ASK THE HOST</label><input id="join-passcode" value={joinPasscode} onChange={(event) => setJoinPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="one-time-code" placeholder="Enter the host’s passcode" required /></>}<button type="submit" disabled={busy}>{busy ? "🔐 Checking the guest list…" : lobby ? "🌙 Enter the lobby →" : "🥳 Enter the party →"}</button><small>🔐 Room code + passcode keeps random party crashers outside.</small></form></div>}
      <div className="flyaway-layer" aria-hidden="true">{flyaways.map((item) => <span style={{ left: `${item.x}%` }} key={item.id}>{item.emoji}</span>)}</div>
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
