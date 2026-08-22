"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Color = "coral" | "sun" | "blue" | "mint";
type Person = { id: string; initials: string; name: string; score: number; color: Color };
type Reaction = { id: string; participantId: string; avatar: string; name: string; message: string; icon: "▲" | "▼"; tone: "up" | "down"; createdAt?: string };
type PartyState = { code: string; title: string; viewer: Person; people: Person[]; currentTrack: Track | null; reactions: Reaction[]; pendingCount: number; queueCount: number; status: "live" | "ended" };
type Track = { id: string; title: string; artist: string; duration: string; color: Color };
type RoomSummary = { code: string; title: string; status: "live" | "ended" };

function Artwork({ tone, compact = false }: { tone: Color; compact?: boolean }) {
  return <div className={`album-art ${tone} ${compact ? "compact" : ""}`} role="img" aria-label="Colorful geometric album artwork"><span className="album-circle" /><span className="album-stair" /><span className="album-star">✦</span></div>;
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
  const visiblePeople = party ? (showEveryone ? party.people : party.people.slice(0, 4)) : [];

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
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(participantId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (active) { setParty(data.party); setRoom({ code: data.party.code, title: data.party.title, status: data.party.status }); }
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
      setParty(data.party);
      setNotice(`You’re in, ${joinName.trim()}.`);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Could not join."); }
    finally { setBusy(false); }
  }

  async function react(kind: "up" | "down") {
    if (busy || myReaction === kind || !party?.currentTrack) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "react", kind });
      setParty(data.party);
      setNotice(data.skipped ? "Three boos. Next song!" : kind === "up" ? "Cheer sent! +3 to the picker." : "Anonymous boo delivered.");
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
      setParty(data.party);
      setAddOpen(false);
      setNotice(`${data.submittedTrack.title} is secretly in the mix.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Song could not be added.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">ROOM LOST</p><h1>{error}</h1><Link href="/">Try another code →</Link></main>;
  if (!room) return <main className="loading-room"><span className="brand-mark">HM</span><p>Finding room {code}…</p></main>;

  const ended = room.status === "ended" || party?.status === "ended";
  return (
    <main className="party-shell">
      <div className="shape shape-one" aria-hidden="true" /><div className="shape shape-two" aria-hidden="true" /><div className="shape shape-three" aria-hidden="true" />
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic</span></Link>
        <div className="room-pill"><span className={`live-dot ${ended ? "ended" : ""}`} /> {ended ? "ENDED" : "LIVE"} · ROOM {room.code}</div>
      </header>
      <section className="event-heading" id="top">
        <div><p className="eyebrow">{ended ? "FINAL SCORES ARE IN" : "THE ROOM IS LISTENING"}</p><h1>{room.title}</h1></div>
        {!ended && party && <button className="add-song-button" type="button" onClick={() => setAddOpen(true)}><span aria-hidden="true">＋</span> Add a song</button>}
      </section>

      {party && ended && <section className="ended-banner"><strong>THAT’S A WRAP.</strong><span>No more votes. Bragging may continue indefinitely.</span></section>}

      {party && <div className="party-grid">
        <section className={`now-playing ${!party.currentTrack ? "empty-player" : ""}`} aria-labelledby="playing-title">
          <div className="section-kicker"><span>{party.currentTrack ? "NOW PLAYING" : "THE SPEAKER IS WAITING"}</span><span>{party.queueCount} SECRETLY QUEUED</span></div>
          {party.currentTrack ? <>
            <div className="track-card"><Artwork tone={party.currentTrack.color} /><div className="track-copy"><p className="track-label">CURRENT CHAOS</p><h2 id="playing-title">{party.currentTrack.title}</h2><p className="artist">{party.currentTrack.artist}</p><p className="host-playback-note">♫ Playback lives on the host speaker</p><p className="submitted">Submitted by a mystery human</p></div></div>
            {!ended && <div className="reaction-panel"><div className="reaction-actions">
              <button className={`reaction-button cheer ${myReaction === "up" ? "selected" : ""}`} type="button" onClick={() => void react("up")} disabled={busy} aria-pressed={myReaction === "up"}><span className="reaction-icon">▲</span><span><strong>CHEER</strong><small>{myReaction === "up" ? "you cheered" : "make some noise"}</small></span></button>
              <button className={`reaction-button boo ${myReaction === "down" ? "selected" : ""}`} type="button" onClick={() => void react("down")} disabled={busy} aria-pressed={myReaction === "down"}><span className="reaction-icon">▼</span><span><strong>BOO</strong><small>{myReaction === "down" ? "your secret is safe" : "3 boos skip it"}</small></span></button>
            </div><div className="boo-meter"><span className="boo-count">{boos}</span><div><strong>{boos === 0 ? "NO BOOS YET" : boos === 1 ? "ONE BOO IN" : "ONE BOO TO GO"}</strong><small>{Math.max(0, 3 - boos)} more and it’s gone.</small></div><div className="meter-pips" aria-label={`${boos} of three boos`}>{[0, 1, 2].map((index) => <i className={index < boos ? "filled" : ""} key={index} />)}</div></div></div>}
          </> : <div className="empty-player-copy"><span>♫</span><h2 id="playing-title">Silence has entered the chat.</h2><p>Add the first song and the room starts immediately.</p>{!ended && <button type="button" onClick={() => setAddOpen(true)}>Add the first song →</button>}</div>}
        </section>

        <aside className="party-sidebar"><section className="sidebar-card score-card"><div className="score-topline"><span>YOUR SCORE</span><span>★</span></div><strong className="big-score">{party.viewer.score}</strong><p>{party.pendingCount ? `${party.pendingCount} secret pick${party.pendingCount > 1 ? "s" : ""} waiting.` : "Still respectable. For now."}</p></section>
          <section className="sidebar-card crowd-card"><div className="card-title-row"><h2>THE CROWD</h2><span>{party.people.length} HERE</span></div><div className="people-list">{visiblePeople.map((person) => <div className="person-row" key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><strong>{person.name}</strong><span className="person-score">{person.score}</span></div>)}</div>{party.people.length > 4 && <button className="text-button" type="button" onClick={() => setShowEveryone((value) => !value)}>{showEveryone ? "Show less ↑" : "Show everybody →"}</button>}</section>
        </aside>
      </div>}

      {party && <section className="activity-card"><div className="card-title-row"><h2>ROOM NOISE</h2><span>LIVE REACTIONS</span></div><div className="activity-list" aria-live="polite">{party.reactions.length ? party.reactions.map((reaction) => <div className={`activity-row ${reaction.tone}`} key={reaction.id}><span className="activity-avatar">{reaction.avatar}</span><p><strong>{reaction.name}</strong> {reaction.message}</p><span className="activity-icon">{reaction.icon}</span><time>now</time></div>) : <p className="quiet-feed">It’s suspiciously quiet in here.</p>}</div></section>}

      {addOpen && party && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAddOpen(false)}><section className="song-modal spotify-song-modal" role="dialog" aria-modal="true" aria-labelledby="add-song-title"><div className="modal-topline"><div><p className="eyebrow">SECRET WEAPON</p><h2 id="add-song-title">Add a Spotify song</h2></div><button className="close-button" type="button" onClick={() => setAddOpen(false)} aria-label="Close">×</button></div><div className="spotify-add-guide"><strong>Spotify → Share → Copy song link</strong><span>Paste the track below. Its title is checked before it joins the secret queue.</span></div><form className="link-form spotify-link-form" onSubmit={(event) => void submitLink(event)}><label htmlFor="song-link">SPOTIFY TRACK LINK</label><input id="song-link" name="song-link" type="url" inputMode="url" autoComplete="off" placeholder="https://open.spotify.com/track/..." required /><button type="submit" disabled={busy}>{busy ? "Checking Spotify…" : "Add to the secret queue →"}</button></form><p className="queue-note">The queue stays secret. You have {Math.max(0, 3 - party.pendingCount)} submission slots left.</p></section></div>}

      {!participantId && !ended && <div className="modal-backdrop join-backdrop"><form className="join-card" onSubmit={join}><span className="join-mark">HM</span><p className="eyebrow">ROOM {room.code}</p><h2>Who just walked in?</h2><p>You’re joining <strong>{room.title}</strong>. Pick a name and collect your 30 points.</p><label htmlFor="join-name">YOUR PARTY NAME</label><input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} placeholder="e.g. Dance Floor Dave" /><button type="submit" disabled={busy}>{busy ? "Joining…" : "Enter the party →"}</button><small>No account. This phone remembers you for this room.</small></form></div>}
      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
