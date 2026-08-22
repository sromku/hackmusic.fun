"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Person = {
  id: string;
  initials: string;
  name: string;
  score: number;
  color: "sun" | "coral" | "blue" | "mint";
};

type Reaction = {
  id: string;
  participantId: string;
  avatar: string;
  name: string;
  message: string;
  icon: "▲" | "▼";
  tone: "up" | "down";
  createdAt?: string;
};

type Track = {
  id: string;
  title: string;
  artist: string;
  duration: string;
  color: "coral" | "sun" | "blue" | "mint";
};

type PartyState = {
  code: string;
  title: string;
  viewer: Person;
  people: Person[];
  currentTrack: Track;
  reactions: Reaction[];
  pendingCount: number;
  status?: "live" | "ended";
};

const demoViewerId = "p-you";

const catalog: Track[] = [
  { id: "spotify-1", title: "Midnight City", artist: "M83", duration: "4:03", color: "blue" },
  { id: "spotify-2", title: "Electric Feel", artist: "MGMT", duration: "3:49", color: "sun" },
  { id: "spotify-3", title: "Dog Days Are Over", artist: "Florence + The Machine", duration: "4:12", color: "coral" },
  { id: "spotify-4", title: "Lisztomania", artist: "Phoenix", duration: "4:02", color: "mint" },
  { id: "spotify-5", title: "1901", artist: "Phoenix", duration: "3:13", color: "blue" },
  { id: "spotify-6", title: "D.A.N.C.E.", artist: "Justice", duration: "4:02", color: "sun" },
];

const initialParty: PartyState = {
  code: "LIME-42",
  title: "Hackathon Afterdark",
  viewer: { id: demoViewerId, initials: "YO", name: "You", score: 30, color: "sun" },
  people: [
    { id: demoViewerId, initials: "YO", name: "You", score: 30, color: "sun" },
    { id: "p-nora", initials: "NA", name: "Nora", score: 39, color: "coral" },
    { id: "p-omar", initials: "OM", name: "Omar", score: 33, color: "blue" },
    { id: "p-mika", initials: "MI", name: "Mika", score: 27, color: "mint" },
    { id: "p-lena", initials: "LE", name: "Lena", score: 33, color: "sun" },
  ],
  currentTrack: { id: "spotify-current", title: "The Less I Know The Better", artist: "Tame Impala", duration: "3:36", color: "coral" },
  reactions: [
    { id: "r1", participantId: "p-nora", avatar: "NA", name: "Nora", message: "is feeling this", icon: "▲", tone: "up" },
    { id: "r2", participantId: "p-mika", avatar: "?", name: "Someone", message: "booed this song", icon: "▼", tone: "down" },
    { id: "r3", participantId: "p-omar", avatar: "OM", name: "Omar", message: "turned it up", icon: "▲", tone: "up" },
  ],
  pendingCount: 0,
  status: "live",
};

function Artwork({ tone, compact = false }: { tone: Track["color"]; compact?: boolean }) {
  return (
    <div className={`album-art ${tone} ${compact ? "compact" : ""}`} role="img" aria-label="Colorful geometric album artwork">
      <span className="album-circle" />
      <span className="album-stair" />
      <span className="album-star">✦</span>
    </div>
  );
}

export default function Home() {
  const [party, setParty] = useState(initialParty);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showEveryone, setShowEveryone] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [participantId, setParticipantId] = useState("");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinName, setJoinName] = useState("");

  const myReaction = party.reactions.find((reaction) => reaction.participantId === participantId)?.tone;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;
  const visiblePeople = showEveryone ? party.people : party.people.slice(0, 4);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalog.slice(0, 4);
    return catalog.filter((track) => `${track.title} ${track.artist}`.toLowerCase().includes(query));
  }, [search]);

  useEffect(() => {
    const savedParticipant = window.localStorage.getItem("hackmusic-participant");
    if (!savedParticipant) {
      // Device identity is intentionally restored from browser storage after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJoinOpen(true);
      return;
    }
    setParticipantId(savedParticipant);
  }, []);

  useEffect(() => {
    if (!participantId) return;
    let active = true;
    const refresh = () => fetch(`/api/party?code=LIME-42&participantId=${participantId}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { party?: PartyState }) => { if (active && data.party) setParty(data.party); })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [participantId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function postAction(payload: Record<string, unknown>) {
    if (!participantId) throw new Error("Join the party first.");
    const response = await fetch("/api/party", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: party.code, participantId, ...payload }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "That did not work." }));
      throw new Error(error.error ?? "That did not work.");
    }
    return response.json() as Promise<{ party: PartyState; skipped?: boolean }>;
  }

  async function joinParty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = joinName.trim();
    if (name.length < 2) { setNotice("Give us at least two letters."); return; }
    setBusy(true);
    const newParticipantId = `p-${crypto.randomUUID()}`;
    try {
      const response = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", code: party.code, participantId: newParticipantId, name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not join.");
      window.localStorage.setItem("hackmusic-participant", newParticipantId);
      setParticipantId(newParticipantId);
      setParty(data.party);
      setJoinOpen(false);
      setNotice(`You’re in, ${name}. Start with something dangerous.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not join.");
    } finally {
      setBusy(false);
    }
  }

  async function react(kind: "up" | "down") {
    if (busy || myReaction === kind) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "react", kind });
      setParty(data.party);
      setNotice(data.skipped ? "Three boos. Next song!" : kind === "up" ? "Cheer sent! +3 to the picker." : "Anonymous boo delivered.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reaction failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addTrack(track: Track) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await postAction({ action: "submit", track });
      setParty(data.party);
      setAddOpen(false);
      setSearch("");
      setNotice(`${track.title} is secretly in the mix.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Song could not be added.");
    } finally {
      setBusy(false);
    }
  }

  function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("song-link") ?? "").trim();
    if (!value) return;
    const custom: Track = { id: `link-${Date.now()}`, title: "Song from your link", artist: "Spotify", duration: "—", color: "mint" };
    void addTrack(custom);
  }

  return (
    <main className="party-shell">
      <div className="shape shape-one" aria-hidden="true" />
      <div className="shape shape-two" aria-hidden="true" />
      <div className="shape shape-three" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="HackMusic home">
          <span className="brand-mark">HM</span><span>HackMusic</span>
        </a>
        <div className="room-pill"><span className="live-dot" /> LIVE · ROOM {party.code}</div>
      </header>

      <section className="event-heading" id="top">
        <div>
          <p className="eyebrow">FRIDAY NIGHT MIX-OFF</p>
          <h1>{party.title}</h1>
        </div>
        <button className="add-song-button" type="button" onClick={() => setAddOpen(true)}>
          <span aria-hidden="true">＋</span> Add a song
        </button>
      </section>

      <div className="party-grid">
        <section className="now-playing" aria-labelledby="playing-title">
          <div className="section-kicker"><span>NOW PLAYING</span><span>2:18 / {party.currentTrack.duration}</span></div>
          <div className="track-card">
            <Artwork tone={party.currentTrack.color} />
            <div className="track-copy">
              <p className="track-label">CURRENT CHAOS</p>
              <h2 id="playing-title">{party.currentTrack.title}</h2>
              <p className="artist">{party.currentTrack.artist}</p>
              <div className="progress-track" aria-label="Song progress: 64 percent"><span /></div>
              <p className="submitted">Submitted by a mystery human</p>
            </div>
          </div>

          <div className="reaction-panel">
            <div className="reaction-actions">
              <button className={`reaction-button cheer ${myReaction === "up" ? "selected" : ""}`} type="button" onClick={() => void react("up")} disabled={busy} aria-pressed={myReaction === "up"}>
                <span className="reaction-icon">▲</span>
                <span><strong>CHEER</strong><small>{myReaction === "up" ? "you cheered" : "make some noise"}</small></span>
              </button>
              <button className={`reaction-button boo ${myReaction === "down" ? "selected" : ""}`} type="button" onClick={() => void react("down")} disabled={busy} aria-pressed={myReaction === "down"}>
                <span className="reaction-icon">▼</span>
                <span><strong>BOO</strong><small>{myReaction === "down" ? "your secret is safe" : "3 boos skip it"}</small></span>
              </button>
            </div>
            <div className="boo-meter">
              <span className="boo-count">{boos}</span>
              <div><strong>{boos === 0 ? "NO BOOS YET" : boos === 1 ? "ONE BOO IN" : "ONE BOO TO GO"}</strong><small>{Math.max(0, 3 - boos)} more and it’s gone.</small></div>
              <div className="meter-pips" aria-label={`${boos} of three boos`}>{[0, 1, 2].map((index) => <i className={index < boos ? "filled" : ""} key={index} />)}</div>
            </div>
          </div>
        </section>

        <aside className="party-sidebar">
          <section className="sidebar-card score-card">
            <div className="score-topline"><span>YOUR SCORE</span><span>★</span></div>
            <strong className="big-score">{party.viewer.score}</strong>
            <p>{party.pendingCount ? `${party.pendingCount} secret pick${party.pendingCount > 1 ? "s" : ""} waiting.` : "Still respectable. For now."}</p>
          </section>

          <section className="sidebar-card crowd-card">
            <div className="card-title-row"><h2>THE CROWD</h2><span>{party.people.length} HERE</span></div>
            <div className="people-list">
              {visiblePeople.map((person) => (
                <div className="person-row" key={person.id}>
                  <span className={`avatar ${person.color}`}>{person.initials}</span>
                  <strong>{person.name}</strong>
                  <span className="person-score">{person.score}</span>
                </div>
              ))}
            </div>
            {party.people.length > 4 && <button className="text-button" type="button" onClick={() => setShowEveryone((value) => !value)}>{showEveryone ? "Show less ↑" : "Show everybody →"}</button>}
          </section>
        </aside>
      </div>

      <section className="activity-card" aria-labelledby="activity-title">
        <div className="card-title-row"><h2 id="activity-title">ROOM NOISE</h2><span>LIVE REACTIONS</span></div>
        <div className="activity-list" aria-live="polite">
          {party.reactions.map((reaction) => (
            <div className={`activity-row ${reaction.tone}`} key={reaction.id}>
              <span className="activity-avatar">{reaction.avatar}</span>
              <p><strong>{reaction.name}</strong> {reaction.message}</p>
              <span className="activity-icon">{reaction.icon}</span>
              <time>{reaction.createdAt ? "just now" : "now"}</time>
            </div>
          ))}
        </div>
      </section>

      {addOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setAddOpen(false)}>
          <section className="song-modal" role="dialog" aria-modal="true" aria-labelledby="add-song-title">
            <div className="modal-topline">
              <div><p className="eyebrow">SECRET WEAPON</p><h2 id="add-song-title">Add a song</h2></div>
              <button className="close-button" type="button" onClick={() => setAddOpen(false)} aria-label="Close add song dialog">×</button>
            </div>
            <label className="search-field">
              <span>SEARCH THE MUSIC</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Song or artist..." />
            </label>
            <div className="song-results">
              {results.map((track) => (
                <button className="song-result" type="button" onClick={() => void addTrack(track)} key={track.id} disabled={busy}>
                  <Artwork tone={track.color} compact />
                  <span><strong>{track.title}</strong><small>{track.artist} · {track.duration}</small></span>
                  <b>＋</b>
                </button>
              ))}
              {!results.length && <p className="empty-results">Nothing found. Try a Spotify link instead.</p>}
            </div>
            <form className="link-form" onSubmit={submitLink}>
              <label htmlFor="song-link">OR PASTE A SPOTIFY LINK</label>
              <div><input id="song-link" name="song-link" type="url" placeholder="https://open.spotify.com/track/..." /><button type="submit">Add</button></div>
            </form>
            <p className="queue-note">The queue stays secret. You have {3 - party.pendingCount} submission slots left.</p>
          </section>
        </div>
      )}

      {joinOpen && (
        <div className="modal-backdrop join-backdrop">
          <form className="join-card" onSubmit={joinParty}>
            <span className="join-mark">HM</span>
            <p className="eyebrow">ROOM {party.code}</p>
            <h2>Who just walked in?</h2>
            <p>Pick a name. You start with 30 points and questionable power over the speaker.</p>
            <label htmlFor="join-name">YOUR PARTY NAME</label>
            <input id="join-name" value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} placeholder="e.g. Dance Floor Dave" />
            <button type="submit" disabled={busy}>{busy ? "Joining…" : "Enter the party →"}</button>
            <small>No account. This phone remembers you for this room.</small>
          </form>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
