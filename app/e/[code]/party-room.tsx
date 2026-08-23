"use client";

import { FormEvent, useEffect, useState } from "react";
import { AVATAR_EMOJIS } from "../../../lib/avatar-emojis";
import { artworkVariant, durationSeconds, formatActivityTime, formatMusicDuration, formatPartyStart, mySongStatusLabel, spotifyTrackWebUrl } from "../../../lib/party-format";
import { MAX_PENDING_TRACKS_PER_PERSON } from "../../../lib/party-rules";
import type { MySong, ParticipantParty, PartyActivity, PartyColor, PartyTrack, RoomSummary } from "../../../lib/party-contract";

function Artwork({ tone, seed }: { tone: PartyColor; seed: string }) {
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

  const myReaction = party?.reactions.find((reaction) => reaction.mine)?.tone;
  const boos = party?.reactions.filter((reaction) => reaction.tone === "down").length ?? 0;
  const ended = room?.status === "ended" || party?.status === "ended";
  const lobby = room?.status === "lobby" || party?.status === "lobby";
  const hasPlayedSong = (party?.activity ?? []).some((item) => item.tone === "song");
  const visiblePeople = party ? ended ? [...party.people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : showEveryone ? party.people : party.people.slice(0, 4) : [];

  useEffect(() => {
    const saved = window.localStorage.getItem(`hackmusic:${code}:participant`) ?? "";
    const pendingHandoff = window.sessionStorage.getItem(`hackmusic:${code}:handoff`) ?? "";
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
          setRoom({ code: data.party.code, title: data.party.title, status: data.party.status, scheduledFor: data.party.scheduledFor });
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

  async function postAction(payload: Record<string, unknown>) {
    if (!participantId) throw new Error("Join the room first.");
    const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, participantId, ...payload }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "That did not work.");
    return data as { party: ParticipantParty; skipped?: boolean; submittedTrack?: PartyTrack };
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinName.trim().length < 2) { setNotice("Give us at least two letters."); return; }
    setBusy(true);
    const id = `p-${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", code, participantId: id, name: joinName, passcode: joinPasscode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not join.");
      window.localStorage.setItem(`hackmusic:${code}:participant`, id);
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
    try {
      const data = await postAction({ action: "react", kind });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setNotice(data.skipped ? "⏭️ Three boos! Next song!" : kind === "up" ? "🙌 Cheer locked in! +3 to the picker." : "👻 Anonymous boo locked in.");
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
      if (!data.submittedTrack) throw new Error("Spotify did not confirm that track.");
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

  function surpriseAvatar() {
    const alternatives = AVATAR_EMOJIS.filter((option) => option.emoji !== party?.viewer.initials);
    const choice = alternatives[Math.floor(Math.random() * alternatives.length)] ?? AVATAR_EMOJIS[0];
    void changeAvatar(choice.emoji);
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">ROOM LOST</p><h1>{error}</h1><a href="/">Try another code →</a></main>;
  if (!room) return <main className="loading-room"><span className="brand-mark">HM</span><p>Finding room {code}…</p></main>;
  const currentSpotifyUrl = party?.currentTrack ? spotifyTrackWebUrl(party.currentTrack.id) : "";
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

      {party && ended && <section className="ended-banner"><strong>🏁 THAT’S A WRAP.</strong><span>🏆 No more votes. Bragging may continue indefinitely.</span></section>}
      {party && lobby && <section className="lobby-banner"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY</p><strong>Build the secret queue before the speakers wake up.</strong><span>Expected start: {formatPartyStart(party.scheduledFor)}. The host decides the exact moment.</span></div><div className="lobby-count"><strong>{party.queueCount}</strong><span>{party.queueCount === 1 ? "SECRET SONG" : "SECRET SONGS"}</span></div></section>}

      {party && <div className="party-grid">
        <section className={`now-playing ${!party.currentTrack ? "empty-player" : ""}`} aria-labelledby="playing-title">
          <div className="section-kicker"><span>{ended ? party.currentTrack ? "📼 FINAL SONG" : "🏁 SPEAKER RETIRED" : party.currentTrack ? "🎵 NOW PLAYING" : lobby ? "🌙 PLAYBACK STARTS LATER" : "🔇 THE SPEAKER IS WAITING"}</span><span>{ended ? `📦 ${party.queueCount} LEFT UNPLAYED` : `🤫 ${party.queueCount} SECRETLY QUEUED`}</span></div>
          {party.currentTrack ? <>
            <div className="track-card"><Artwork tone={party.currentTrack.color} seed={party.currentTrack.id} /><div className="track-copy"><p className="track-label">{ended ? "🏁 FINAL CHAOS" : "⚡ CURRENT CHAOS"}</p><h2 id="playing-title">{party.currentTrack.title}</h2><div className="track-meta-row"><p className="artist">🎤 {party.currentTrack.artist}</p>{currentSpotifyUrl && <a className="spotify-save-link" href={currentSpotifyUrl} target="_blank" rel="noreferrer" aria-label={`Open ${party.currentTrack.title} by ${party.currentTrack.artist} in Spotify`}>＋ Add to my Spotify ↗</a>}</div><p className="submitted">🕵️ Submitted by a mystery human</p></div></div>
            {!ended && <div className="reaction-panel"><div className="reaction-actions">
              <button className={`reaction-button cheer ${myReaction === "up" ? "selected" : ""}`} type="button" onClick={() => void react("up")} disabled={busy || Boolean(myReaction)} aria-pressed={myReaction === "up"}><span className="reaction-icon" aria-hidden="true">🙌</span><span><strong>CHEER</strong><small>{myReaction === "up" ? "locked in" : myReaction ? "vote already locked" : "make some noise"}</small></span>{myReaction === "up" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
              <button className={`reaction-button boo ${myReaction === "down" ? "selected" : ""}`} type="button" onClick={() => void react("down")} disabled={busy || Boolean(myReaction)} aria-pressed={myReaction === "down"}><span className="reaction-icon" aria-hidden="true">👻</span><span><strong>BOO</strong><small>{myReaction === "down" ? "locked anonymously" : myReaction ? "vote already locked" : "3 boos skip it"}</small></span>{myReaction === "down" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
            </div>{myReaction && <div className="reaction-choice-note" role="status"><strong>{myReaction === "up" ? "🙌 You cheered" : "👻 You booed anonymously"}</strong><span>Vote locked for this song. No take-backs.</span></div>}<div className="boo-meter"><span className="boo-count">{boos}</span><div><strong>{boos === 0 ? "👻 NO BOOS YET" : boos === 1 ? "👻 ONE BOO IN" : "😬 ONE BOO TO GO"}</strong><small>{Math.max(0, 3 - boos)} more and it’s gone.</small></div><div className="meter-pips" aria-label={`${boos} of three boos`}>{[0, 1, 2].map((index) => <i className={index < boos ? "filled" : ""} key={index} />)}</div></div></div>}
          </> : <div className="empty-player-copy"><span>{ended ? "🏁" : lobby ? "🤫" : hasPlayedSong ? "🎚️" : "🦗"}</span><h2 id="playing-title">{ended ? "The room has spoken." : lobby ? "The queue is undercover." : hasPlayedSong ? "The last song left the chat." : "Silence has entered the chat."}</h2><p>{ended ? "🏆 Final scores are frozen. The music stopped; the bragging did not." : lobby ? "🎵 Add secret songs now. Reactions unlock when the host starts the party." : hasPlayedSong ? "🎵 That song finished. Add another secret song and keep the speaker employed." : "🎵 Add the first song and the room starts immediately."}</p>{!ended && <button type="button" onClick={() => setAddOpen(true)}>{lobby ? "🤫 Add a secret song →" : hasPlayedSong ? "🎶 Add another song →" : "🎶 Add the first song →"}</button>}</div>}
        </section>

        <aside className={`party-sidebar ${ended ? "scores-revealed" : "scores-hidden"}`}>{ended && <section className="sidebar-card score-card"><div className="score-topline"><span>🏆 YOUR FINAL SCORE</span><span>⭐</span></div><strong className="big-score">{party.viewer.score ?? "—"}</strong><p>🧊 Frozen forever. Brag responsibly.</p></section>}
          <section className="sidebar-card crowd-card"><div className="card-title-row"><h2>{ended ? "🏆 FINAL SCORES" : "🪩 THE CROWD"}</h2><span>{ended ? "👀 REVEALED" : `🎉 ${party.people.length} HERE`}</span></div><button className="party-avatar-trigger" type="button" onClick={() => setAvatarOpen(true)}><span className={`avatar ${party.viewer.color}`}>{party.viewer.initials}</span><span><small>YOUR PARTY FACE</small><strong>Tap to unleash an emoji</strong></span><b>CHANGE →</b></button><div className="people-list">{visiblePeople.map((person) => <div className="person-row" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}</strong>{ended && <span className="person-score">{person.score ?? "—"}</span>}</div>)}</div>{!ended && party.people.length > 4 && <button className="text-button" type="button" onClick={() => setShowEveryone((value) => !value)}>{showEveryone ? "Show less ↑" : "Show everybody →"}</button>}</section>
        </aside>
      </div>}

      {party && <section className="activity-card"><div className="card-title-row"><h2>🔊 ROOM NOISE</h2><span>📜 FULL PARTY HISTORY</span></div><div className="activity-list" role="log" aria-live="polite" aria-label="Scrollable history of songs and reactions since the party began">{[...(party.activity ?? [])].reverse().map((item) => <div className={`activity-row ${item.tone}${item.tone === "song" ? " song-start" : ""}`} key={item.id}><span className="activity-avatar">{item.avatar}</span>{item.tone === "song" ? <p><strong>🎶 Now playing:</strong> <span dir="auto">{item.trackTitle}</span></p> : <p><span className="activity-emoji" aria-hidden="true">{item.tone === "up" ? "🎉" : "👻"}</span> <strong>{item.name}</strong> {item.message} <b dir="auto">“{item.trackTitle}”</b></p>}<span className="activity-icon" aria-hidden="true">{item.icon}</span><time dateTime={item.createdAt}>{formatActivityTime(item.createdAt)}</time></div>)}{!(party.activity ?? []).length && <p className="quiet-feed">{ended ? "📼 A remarkably peaceful party. No songs or reactions made the history book." : "🦗 It’s suspiciously quiet in here… The full story will appear here."}</p>}</div><p className="activity-scroll-hint">↕️ Scroll through the history. At either end, keep scrolling to continue through the page.</p></section>}

      {party && <section className="my-music-card" aria-labelledby="my-music-title">
        <div className="my-music-heading"><div><p className="eyebrow">🔐 PRIVATE TO THIS BROWSER</p><h2 id="my-music-title">🎧 My music</h2></div><div className="my-music-heading-copy"><p>Your picks and your reactions. Nobody else gets this backstage pass.</p><strong className="my-music-total"><span>⏱️ TOTAL MUSIC EVER ADDED</span>{formatMusicDuration(myMusicSeconds)}</strong></div></div>
        <div className="my-music-grid">
          <article className="my-music-column my-queue-column">
            <div className="my-column-title"><div><span>{ended ? "📦" : "🤫"}</span><div><h3>{ended ? "Left in my queue" : "Still in my queue"}</h3><p>{ended ? "The party ended before these escaped." : "The room still hides when they’ll play."}</p></div></div><b>{waitingSongs.length}</b></div>
            <div className="my-track-list">{waitingSongs.map((song) => <div className="my-track-row" key={song.queueId}>
              <span className={`my-track-art ${song.color}`} aria-hidden="true">♪</span>
              <div className="my-track-copy"><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist} · {song.duration}</span><small>{mySongStatusLabel(song, ended)}</small></div>
              {!ended && (removeConfirmId === song.queueId ? <div className="remove-confirm" aria-label={`Confirm removal of ${song.title}`}><button type="button" onClick={() => setRemoveConfirmId("")} disabled={busy}>Keep</button><button className="remove-now" type="button" onClick={() => void removeSong(song)} disabled={busy}>{busy ? "Removing…" : "Remove"}</button></div> : <button className="remove-song-button" type="button" onClick={() => setRemoveConfirmId(song.queueId)} disabled={busy} aria-label={`Remove ${song.title} from your queue`}>Remove</button>)}
            </div>)}{waitingSongs.length === 0 && <p className="my-music-empty">{ended ? "📭 Nothing was stranded. Clean exit." : "🕳️ No secret picks waiting. Suspicious."}</p>}</div>
          </article>

          <article className="my-music-column">
            <div className="my-column-title"><div><span>📼</span><div><h3>My played songs</h3><p>What happened to the songs you smuggled in.</p></div></div><b>{submittedHistory.length}</b></div>
            <div className="my-track-list">{submittedHistory.map((song) => <a className="my-track-row my-track-link" href={spotifyTrackWebUrl(song.id)} target="_blank" rel="noreferrer" key={song.queueId}>
              <span className={`my-track-art ${song.color}`} aria-hidden="true">♪</span><span className="my-track-copy"><strong dir="auto">{song.title}</strong><span dir="auto">{song.artist} · {song.duration}</span><small>{mySongStatusLabel(song, ended)}</small></span><span className="my-track-arrow" aria-hidden="true">↗</span>
            </a>)}{submittedHistory.length === 0 && <p className="my-music-empty">🎚️ Your songs have not reached the speaker yet.</p>}</div>
          </article>

          <article className="my-music-column my-reactions-column">
            <div className="my-column-title"><div><span>🫣</span><div><h3>My reactions</h3><p>Your cheers—and your privately remembered boos.</p></div></div><b>{party.myReactionHistory.length}</b></div>
            <div className="my-track-list">{party.myReactionHistory.map((reaction) => <a className={`my-track-row my-track-link my-reaction-history ${reaction.tone}`} href={spotifyTrackWebUrl(reaction.id)} target="_blank" rel="noreferrer" key={reaction.reactionId}>
              <span className="my-reaction-mark" aria-hidden="true">{reaction.tone === "up" ? "🙌" : "👻"}</span><span className="my-track-copy"><strong dir="auto">{reaction.title}</strong><span dir="auto">{reaction.artist}</span><small>{reaction.tone === "up" ? "You cheered" : "You booed anonymously"} · {mySongStatusLabel({ status: reaction.songStatus, skipReason: reaction.skipReason, skipPercent: reaction.skipPercent }, ended)}</small></span><span className="my-track-arrow" aria-hidden="true">↗</span>
            </a>)}{party.myReactionHistory.length === 0 && <p className="my-music-empty">🧘 No opinions recorded. Astonishing restraint.</p>}</div>
          </article>
        </div>
      </section>}

      {!ended && addOpen && party && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAddOpen(false)}><section className="song-modal spotify-song-modal" role="dialog" aria-modal="true" aria-labelledby="add-song-title"><div className="modal-topline"><div><p className="eyebrow">🤫 SECRET WEAPON</p><h2 id="add-song-title">🎵 Add a Spotify song</h2></div><button className="close-button" type="button" onClick={() => setAddOpen(false)} aria-label="Close">×</button></div><div className="spotify-add-guide"><strong>🟢 Spotify → Share → Copy song link</strong><span>Paste the track below. Its title is checked before it joins the secret queue.</span></div><form className="link-form spotify-link-form" onSubmit={(event) => void submitLink(event)}><label htmlFor="song-link">SPOTIFY TRACK LINK</label><input id="song-link" name="song-link" type="url" inputMode="url" autoComplete="off" placeholder="Paste a full track or short /s/ link…" required /><button type="submit" disabled={busy || party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON}>{busy ? "🔎 Checking Spotify…" : party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON ? "🚧 Your waiting queue is full" : "🤫 Add to the secret queue →"}</button></form><p className="queue-note">🕵️ The queue stays secret. You have {Math.max(0, MAX_PENDING_TRACKS_PER_PERSON - party.pendingCount)} of {MAX_PENDING_TRACKS_PER_PERSON} waiting slots left. Played and skipped songs free their slots.</p></section></div>}

      {avatarOpen && party && <div className="modal-backdrop avatar-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAvatarOpen(false)}><section className="avatar-picker-card" role="dialog" aria-modal="true" aria-labelledby="avatar-picker-title"><div className="modal-topline"><div><p className="eyebrow">🎭 IDENTITY, BUT LOUDER</p><h2 id="avatar-picker-title">Pick your party face</h2></div><button className="close-button" type="button" onClick={() => setAvatarOpen(false)} aria-label="Close avatar picker">×</button></div><p className="avatar-picker-intro">Choose wisely. This tiny face will represent your enormous musical opinions.</p><div className="avatar-grid" role="group" aria-label="Party face emojis">{AVATAR_EMOJIS.map((option) => <button className={party.viewer.initials === option.emoji ? "selected" : ""} type="button" onClick={() => void changeAvatar(option.emoji)} disabled={busy} aria-label={`Use ${option.label} as my party face`} aria-pressed={party.viewer.initials === option.emoji} key={option.emoji}><span aria-hidden="true">{option.emoji}</span><small>{option.label}</small></button>)}</div><button className="avatar-surprise" type="button" onClick={surpriseAvatar} disabled={busy}>{busy ? "✨ Summoning chaos…" : "🎲 Surprise me, algorithm →"}</button><p className="avatar-privacy-note">🔐 Only your avatar changes. Your anonymous boos remain delightfully anonymous.</p></section></div>}

      {!participantId && !ended && <div className="modal-backdrop join-backdrop"><form className="join-card" onSubmit={join}><span className="join-mark">HM</span><p className="eyebrow">🎟️ ROOM {room.code}</p><h2>{lobby ? "The pre-party is open 🌙" : "Who just walked in? 👀"}</h2><p>You’re joining <strong>{room.title}</strong>. {lobby ? "Pick a name and start hiding songs in the queue." : "Pick a name and collect your 30 points ⭐"}</p><label htmlFor="join-name">YOUR PARTY NAME</label><input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} autoComplete="nickname" placeholder="e.g. Dance Floor Dave" required />{room.requiresPasscode && <><label htmlFor="join-passcode">ROOM PASSCODE</label><input id="join-passcode" value={joinPasscode} onChange={(event) => setJoinPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="one-time-code" placeholder="Ask the host" required /></>}<button type="submit" disabled={busy}>{busy ? "🔐 Checking the guest list…" : lobby ? "🌙 Enter the lobby →" : "🥳 Enter the party →"}</button><small>🔐 Room code + passcode keeps random party crashers outside.</small></form></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
