"use client";

import { FormEvent, useEffect, useState } from "react";
import { MAX_PENDING_TRACKS_PER_PERSON } from "../../../lib/party-rules";

type Color = "coral" | "sun" | "blue" | "mint";
type Person = { id: string; initials: string; name: string; score: number | null; color: Color };
type Reaction = { id: string; participantId: string; avatar: string; name: string; message: string; icon: "▲" | "▼"; tone: "up" | "down"; createdAt?: string };
type Activity = { id: string; participantId?: string; avatar: string; name: string; message: string; icon: string; tone: "up" | "down" | "song"; trackTitle: string; createdAt: string };
type PartyState = { code: string; title: string; viewer: Person; people: Person[]; currentTrack: Track | null; reactions: Reaction[]; activity?: Activity[]; pendingCount: number; queueCount: number; status: "lobby" | "live" | "ended"; scheduledFor: string | null };
type Track = { id: string; title: string; artist: string; duration: string; color: Color };
type RoomSummary = { code: string; title: string; status: "lobby" | "live" | "ended"; scheduledFor: string | null };

function artworkVariant(seed: string) {
  return [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7) % 5;
}

function spotifyTrackUrl(value: string) {
  const trackId = value.match(/spotify:track:([A-Za-z0-9]{22})/)?.[1];
  return trackId ? `https://open.spotify.com/track/${trackId}` : "";
}

function activityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function partyStartTime(value: string | null) {
  if (!value) return "when the host is ready";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "when the host is ready" : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function Artwork({ tone, seed }: { tone: Color; seed: string }) {
  return <div className={`album-art ${tone} art-variant-${artworkVariant(seed)}`} role="img" aria-label="Animated geometric artwork generated for this song"><span className="album-circle" /><span className="album-stair" /><span className="album-star">✦</span><span className="album-chaos-dot" /><span className="album-chaos-pill" /><span className="album-chaos-ring" /></div>;
}

export default function PartyRoom({ code }: { code: string }) {
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [party, setParty] = useState<PartyState | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [joinName, setJoinName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [showEveryone, setShowEveryone] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const myReaction = party?.reactions.find((reaction) => reaction.participantId === participantId)?.tone;
  const boos = party?.reactions.filter((reaction) => reaction.tone === "down").length ?? 0;
  const ended = room?.status === "ended" || party?.status === "ended";
  const lobby = room?.status === "lobby" || party?.status === "lobby";
  const visiblePeople = party ? ended ? [...party.people].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : showEveryone ? party.people : party.people.slice(0, 4) : [];

  useEffect(() => {
    const saved = window.localStorage.getItem(`hackmusic:${code}:participant`) ?? "";
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
    let activityHistory: Activity[] = [];
    let activityCursor = "";
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(participantId)}&activityAfter=${encodeURIComponent(activityCursor)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (active) {
          const incoming = (data.party.activity ?? []) as Activity[];
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
    return data as { party: PartyState; skipped?: boolean; submittedTrack?: Track };
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joinName.trim().length < 2) { setNotice("Give us at least two letters."); return; }
    setBusy(true);
    const id = `p-${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", code, participantId: id, name: joinName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not join.");
      window.localStorage.setItem(`hackmusic:${code}:participant`, id);
      setParticipantId(id);
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setNotice(`🥳 You’re in, ${joinName.trim()}!`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not join."); }
    finally { setBusy(false); }
  }

  async function react(kind: "up" | "down") {
    if (busy || myReaction === kind || !party?.currentTrack) return;
    const previousReaction = myReaction;
    setBusy(true);
    try {
      const data = await postAction({ action: "react", kind });
      setParty((current) => ({ ...data.party, activity: current?.activity ?? [] }));
      setNotice(data.skipped ? "⏭️ Three boos! Next song!" : previousReaction ? kind === "up" ? "🔁 Vote changed to Cheer!" : "🔁 Vote changed to Boo!" : kind === "up" ? "🙌 Cheer sent! +3 to the picker." : "👻 Anonymous boo delivered.");
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

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">ROOM LOST</p><h1>{error}</h1><a href="/">Try another code →</a></main>;
  if (!room) return <main className="loading-room"><span className="brand-mark">HM</span><p>Finding room {code}…</p></main>;
  const currentSpotifyUrl = party?.currentTrack ? spotifyTrackUrl(party.currentTrack.id) : "";

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
      {party && lobby && <section className="lobby-banner"><div><p className="eyebrow">🌙 PRE-PARTY LOBBY</p><strong>Build the secret queue before the speakers wake up.</strong><span>Expected start: {partyStartTime(party.scheduledFor)}. The host decides the exact moment.</span></div><div className="lobby-count"><strong>{party.queueCount}</strong><span>{party.queueCount === 1 ? "SECRET SONG" : "SECRET SONGS"}</span></div></section>}

      {party && <div className="party-grid">
        <section className={`now-playing ${!party.currentTrack ? "empty-player" : ""}`} aria-labelledby="playing-title">
          <div className="section-kicker"><span>{party.currentTrack ? "🎵 NOW PLAYING" : lobby ? "🌙 PLAYBACK STARTS LATER" : "🔇 THE SPEAKER IS WAITING"}</span><span>🤫 {party.queueCount} SECRETLY QUEUED</span></div>
          {party.currentTrack ? <>
            <div className="track-card"><Artwork tone={party.currentTrack.color} seed={party.currentTrack.id} /><div className="track-copy"><p className="track-label">⚡ CURRENT CHAOS</p><h2 id="playing-title">{party.currentTrack.title}</h2><div className="track-meta-row"><p className="artist">🎤 {party.currentTrack.artist}</p>{currentSpotifyUrl && <a className="spotify-save-link" href={currentSpotifyUrl} target="_blank" rel="noreferrer" aria-label={`Open ${party.currentTrack.title} by ${party.currentTrack.artist} in Spotify`}>＋ Add to my Spotify ↗</a>}</div><p className="submitted">🕵️ Submitted by a mystery human</p></div></div>
            {!ended && <div className="reaction-panel"><div className="reaction-actions">
              <button className={`reaction-button cheer ${myReaction === "up" ? "selected" : ""}`} type="button" onClick={() => void react("up")} disabled={busy} aria-pressed={myReaction === "up"}><span className="reaction-icon" aria-hidden="true">🙌</span><span><strong>CHEER</strong><small>{myReaction === "up" ? "you picked this" : myReaction === "down" ? "tap to switch" : "make some noise"}</small></span>{myReaction === "up" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
              <button className={`reaction-button boo ${myReaction === "down" ? "selected" : ""}`} type="button" onClick={() => void react("down")} disabled={busy} aria-pressed={myReaction === "down"}><span className="reaction-icon" aria-hidden="true">👻</span><span><strong>BOO</strong><small>{myReaction === "down" ? "your secret is safe" : myReaction === "up" ? "tap to switch" : "3 boos skip it"}</small></span>{myReaction === "down" && <b className="your-vote-badge">✓ YOUR VOTE</b>}</button>
            </div>{myReaction && <div className="reaction-choice-note" role="status"><strong>{myReaction === "up" ? "🙌 You cheered" : "👻 You booed anonymously"}</strong><span>Changed your mind? Tap the other reaction.</span></div>}<div className="boo-meter"><span className="boo-count">{boos}</span><div><strong>{boos === 0 ? "👻 NO BOOS YET" : boos === 1 ? "👻 ONE BOO IN" : "😬 ONE BOO TO GO"}</strong><small>{Math.max(0, 3 - boos)} more and it’s gone.</small></div><div className="meter-pips" aria-label={`${boos} of three boos`}>{[0, 1, 2].map((index) => <i className={index < boos ? "filled" : ""} key={index} />)}</div></div></div>}
          </> : <div className="empty-player-copy"><span>{lobby ? "🤫" : "🦗"}</span><h2 id="playing-title">{lobby ? "The queue is undercover." : "Silence has entered the chat."}</h2><p>{lobby ? "🎵 Add secret songs now. Reactions unlock when the host starts the party." : "🎵 Add the first song and the room starts immediately."}</p>{!ended && <button type="button" onClick={() => setAddOpen(true)}>{lobby ? "🤫 Add a secret song →" : "🎶 Add the first song →"}</button>}</div>}
        </section>

        <aside className={`party-sidebar ${ended ? "scores-revealed" : "scores-hidden"}`}>{ended && <section className="sidebar-card score-card"><div className="score-topline"><span>🏆 YOUR FINAL SCORE</span><span>⭐</span></div><strong className="big-score">{party.viewer.score ?? "—"}</strong><p>🧊 Frozen forever. Brag responsibly.</p></section>}
          <section className="sidebar-card crowd-card"><div className="card-title-row"><h2>{ended ? "🏆 FINAL SCORES" : "🪩 THE CROWD"}</h2><span>{ended ? "👀 REVEALED" : `🎉 ${party.people.length} HERE`}</span></div><div className="people-list">{visiblePeople.map((person) => <div className="person-row" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}</strong>{ended && <span className="person-score">{person.score ?? "—"}</span>}</div>)}</div>{!ended && party.people.length > 4 && <button className="text-button" type="button" onClick={() => setShowEveryone((value) => !value)}>{showEveryone ? "Show less ↑" : "Show everybody →"}</button>}</section>
        </aside>
      </div>}

      {party && <section className="activity-card"><div className="card-title-row"><h2>🔊 ROOM NOISE</h2><span>📜 FULL PARTY HISTORY</span></div><div className="activity-list" role="log" aria-live="polite" aria-label="Scrollable history of songs and reactions since the party began">{[...(party.activity ?? [])].reverse().map((item) => <div className={`activity-row ${item.tone}${item.tone === "song" ? " song-start" : ""}`} key={item.id}><span className="activity-avatar">{item.avatar}</span>{item.tone === "song" ? <p><strong>🎶 Now playing:</strong> <span dir="auto">{item.trackTitle}</span></p> : <p><span className="activity-emoji" aria-hidden="true">{item.tone === "up" ? "🎉" : "👻"}</span> <strong>{item.name}</strong> {item.message} <b dir="auto">“{item.trackTitle}”</b></p>}<span className="activity-icon" aria-hidden="true">{item.icon}</span><time dateTime={item.createdAt}>{activityTime(item.createdAt)}</time></div>)}{!(party.activity ?? []).length && <p className="quiet-feed">🦗 It’s suspiciously quiet in here… The full story will appear here.</p>}</div><p className="activity-scroll-hint">↕️ Scroll inside Room Noise to travel all the way back to the party’s first song.</p></section>}

      {addOpen && party && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAddOpen(false)}><section className="song-modal spotify-song-modal" role="dialog" aria-modal="true" aria-labelledby="add-song-title"><div className="modal-topline"><div><p className="eyebrow">🤫 SECRET WEAPON</p><h2 id="add-song-title">🎵 Add a Spotify song</h2></div><button className="close-button" type="button" onClick={() => setAddOpen(false)} aria-label="Close">×</button></div><div className="spotify-add-guide"><strong>🟢 Spotify → Share → Copy song link</strong><span>Paste the track below. Its title is checked before it joins the secret queue.</span></div><form className="link-form spotify-link-form" onSubmit={(event) => void submitLink(event)}><label htmlFor="song-link">SPOTIFY TRACK LINK</label><input id="song-link" name="song-link" type="url" inputMode="url" autoComplete="off" placeholder="https://open.spotify.com/track/..." required /><button type="submit" disabled={busy || party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON}>{busy ? "🔎 Checking Spotify…" : party.pendingCount >= MAX_PENDING_TRACKS_PER_PERSON ? "🚧 Your waiting queue is full" : "🤫 Add to the secret queue →"}</button></form><p className="queue-note">🕵️ The queue stays secret. You have {Math.max(0, MAX_PENDING_TRACKS_PER_PERSON - party.pendingCount)} of {MAX_PENDING_TRACKS_PER_PERSON} waiting slots left. Played and skipped songs free their slots.</p></section></div>}

      {!participantId && !ended && <div className="modal-backdrop join-backdrop"><form className="join-card" onSubmit={join}><span className="join-mark">HM</span><p className="eyebrow">🎟️ ROOM {room.code}</p><h2>{lobby ? "The pre-party is open 🌙" : "Who just walked in? 👀"}</h2><p>You’re joining <strong>{room.title}</strong>. {lobby ? "Pick a name and start hiding songs in the queue." : "Pick a name and collect your 30 points ⭐"}</p><label htmlFor="join-name">YOUR PARTY NAME</label><input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} placeholder="e.g. Dance Floor Dave" /><button type="submit" disabled={busy}>{busy ? "🚪 Joining…" : lobby ? "🌙 Enter the lobby →" : "🥳 Enter the party →"}</button><small>📱 No account. This phone remembers you for this room.</small></form></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
