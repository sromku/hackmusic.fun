"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type HostedRoom = {
  code: string;
  title: string;
  status: "lobby" | "live" | "ended" | "unknown";
  createdAt: string;
  lastOpenedAt: string;
};

const hostedRoomsKey = "hackmusic:hostedRooms";
const visibleHostedRooms = 3;

function hostedRoomDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved on this browser" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function hostedRoomStatus(value: unknown): HostedRoom["status"] {
  return value === "lobby" || value === "live" || value === "ended" ? value : "unknown";
}

function parseHostedRooms(value: string | null) {
  if (!value) return [] as HostedRoom[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((room): room is HostedRoom => Boolean(room && typeof room === "object" && "code" in room && typeof room.code === "string" && /^[A-Z0-9]{6}$/.test(room.code)))
      .map((room) => ({
        code: room.code,
        title: typeof room.title === "string" && room.title ? room.title : `Room ${room.code}`,
        status: hostedRoomStatus(room.status),
        createdAt: typeof room.createdAt === "string" ? room.createdAt : "",
        lastOpenedAt: typeof room.lastOpenedAt === "string" ? room.lastOpenedAt : room.createdAt || "",
      }));
  } catch {
    return [];
  }
}

function saveHostedRooms(rooms: HostedRoom[]) {
  window.localStorage.setItem(hostedRoomsKey, JSON.stringify(rooms.slice(0, 100)));
}

export default function Home() {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [hostName, setHostName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [preParty, setPreParty] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [hostedRooms, setHostedRooms] = useState<HostedRoom[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closeHistoryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    async function loadHostedRooms() {
      const stored = parseHostedRooms(window.localStorage.getItem(hostedRoomsKey));
      const byCode = new Map(stored.filter((room) => window.localStorage.getItem(`hackmusic:${room.code}:host`)).map((room) => [room.code, room]));
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index) ?? "";
        const code = key.match(/^hackmusic:([A-Z0-9]{6}):host$/)?.[1];
        if (code && !byCode.has(code)) byCode.set(code, { code, title: `Room ${code}`, status: "unknown", createdAt: "", lastOpenedAt: "" });
      }
      const refreshed = await Promise.all([...byCode.values()].map(async (room) => {
        try {
          const response = await fetch(`/api/party?code=${encodeURIComponent(room.code)}`);
          const data = await response.json();
          if (!response.ok) throw new Error();
          return { ...room, title: data.room.title, status: hostedRoomStatus(data.room.status), createdAt: data.room.createdAt ?? room.createdAt };
        } catch {
          return room;
        }
      }));
      const sorted = refreshed.sort((a, b) => (Date.parse(b.lastOpenedAt || b.createdAt) || 0) - (Date.parse(a.lastOpenedAt || a.createdAt) || 0));
      if (active) {
        setHostedRooms(sorted);
        saveHostedRooms(sorted);
      }
    }
    void loadHostedRooms();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeHistoryRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setHistoryOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [historyOpen]);

  function rememberRoomOpened(code: string) {
    const next = hostedRooms.map((room) => room.code === code ? { ...room, lastOpenedAt: new Date().toISOString() } : room)
      .sort((a, b) => (Date.parse(b.lastOpenedAt || b.createdAt) || 0) - (Date.parse(a.lastOpenedAt || a.createdAt) || 0));
    setHostedRooms(next);
    saveHostedRooms(next);
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const scheduledDate = preParty ? new Date(scheduledFor) : null;
      if (preParty && (!scheduledFor || !scheduledDate || Number.isNaN(scheduledDate.getTime()))) {
        throw new Error("Choose when the party is expected to start.");
      }
      const response = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", title: eventName, name: hostName, preParty, scheduledFor: scheduledDate?.toISOString(), website: String(form.get("website") ?? "") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create the room.");
      const code = data.room.code as string;
      window.localStorage.setItem(`hackmusic:${code}:participant`, data.room.participantId);
      window.localStorage.setItem(`hackmusic:${code}:host`, data.room.hostKey);
      const now = new Date().toISOString();
      saveHostedRooms([{ code, title: data.room.title, status: hostedRoomStatus(data.room.status), createdAt: data.room.createdAt ?? now, lastOpenedAt: now }, ...hostedRooms.filter((room) => room.code !== code)]);
      router.push(`/e/${code}/host`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the room.");
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (code.length !== 6) { setMessage("Room codes have six characters."); return; }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/party?code=${encodeURIComponent(code)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Room not found.");
      router.push(`/e/${data.room.code}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Room not found.");
      setBusy(false);
    }
  }

  return (
    <main className="landing-shell">
      <div className="shape shape-one" aria-hidden="true" />
      <div className="shape shape-two" aria-hidden="true" />
      <div className="shape shape-three" aria-hidden="true" />
      <header className="topbar landing-topbar">
        <a className="brand" href="/" aria-label="HackMusic home"><span className="brand-mark">HM</span><span>HackMusic</span></a>
        <span className="landing-tag">🎉 PRIVATE PARTIES · 🔊 LOUD OPINIONS</span>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">🎮 THE PLAYLIST IS NOW A PARTY GAME</p>
          <h1>Let the room<br />pick the vibe.</h1>
          <p className="landing-lede"><span className="lede-play lede-room">Create a room</span>, invite the <span className="lede-play lede-humans">humans</span>, and hand <span className="lede-play lede-everyone">everyone</span> a <span className="lede-play lede-tiny">tiny</span> amount of <span className="lede-play lede-power">power</span> over the <span className="lede-play lede-speaker">speaker</span>.</p>
          <div className="landing-energy" aria-label="Made for six to thirty people sharing one speaker">
            <span className="energy-orb" aria-hidden="true">🪩</span>
            <div><strong>SOME HUMANS · ONE SPEAKER</strong><small>Zero playlist dictators.</small></div>
            <span className="energy-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </div>
          <section className="landing-how" aria-labelledby="how-it-works-title">
            <div className="landing-how-heading"><strong id="how-it-works-title">THREE MOVES. MAXIMUM DRAMA.</strong><span>⚡ instant party rules</span></div>
            <div className="landing-rules">
              <article className="landing-rule rule-song"><span className="rule-step">01</span><span className="rule-icon" aria-hidden="true">🎵</span><div><strong>Drop a secret song</strong><small>Paste a Spotify track. Nobody sees what’s next.</small></div></article>
              <span className="rule-connector" aria-hidden="true">→</span>
              <article className="landing-rule rule-react"><span className="rule-step">02</span><span className="rule-icon" aria-hidden="true">🙌</span><div><strong>React out loud</strong><small>Cheers give +3. Boos stay completely anonymous.</small></div></article>
              <span className="rule-connector" aria-hidden="true">→</span>
              <article className="landing-rule rule-skip"><span className="rule-step">03</span><span className="rule-icon" aria-hidden="true">⏭️</span><div><strong>The crowd can skip</strong><small>Three boos and the next secret song starts.</small></div></article>
            </div>
          </section>
        </div>
        <div className="room-entry-stack">
          <form className="entry-card create-card" onSubmit={createRoom}>
            <div className="entry-card-top"><p className="eyebrow">⚡ START THE CHAOS</p><span>NO APP NEEDED</span></div><h2>Create a room</h2>
            <label htmlFor="event-name">EVENT NAME</label><input id="event-name" value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={60} placeholder="Friday night hackathon" required />
            <label htmlFor="host-name">YOUR NAME</label><input id="host-name" value={hostName} onChange={(event) => setHostName(event.target.value)} maxLength={24} placeholder="The brave host" required />
            <fieldset className="room-start-picker"><legend>WHEN DOES THE MUSIC START?</legend><div>
              <button className={!preParty ? "active" : ""} type="button" aria-pressed={!preParty} onClick={() => setPreParty(false)}><span>⚡</span><strong>Start now</strong><small>First song plays immediately.</small></button>
              <button className={preParty ? "active" : ""} type="button" aria-pressed={preParty} onClick={() => setPreParty(true)}><span>🌙</span><strong>Pre-party lobby</strong><small>Collect songs before the event.</small></button>
            </div></fieldset>
            {preParty && <div className="schedule-field"><label htmlFor="scheduled-for">EXPECTED START TIME</label><input id="scheduled-for" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} required /><small>Guests can join and add secret songs now. You still press Start when everyone is ready.</small></div>}
            <div className="bot-trap" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
            <button type="submit" disabled={busy}>{busy ? "🛠️ Making room…" : preParty ? "🌙 Open the pre-party lobby →" : "🎉 Create my room →"}</button>
          </form>
          <form className="entry-card join-room-card" onSubmit={joinRoom}>
            <div><p className="eyebrow">🎟️ GOT A CODE?</p><h2>Join the room</h2></div>
            <label className="sr-only" htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={6} placeholder="ABC123" required />
            <button type="submit" disabled={busy}>Join →</button>
          </form>
          {message && <p className="landing-message" role="alert">{message}</p>}
          <p className="entry-legal-note">By creating or joining a room, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</p>
        </div>
      </section>
      {hostedRooms.length > 0 && <section className="hosted-history" aria-labelledby="hosted-history-title">
        <div className="hosted-history-heading"><div><p className="eyebrow">🗝️ THIS BROWSER REMEMBERS</p><h2 id="hosted-history-title">Your hosted rooms</h2><p>Private to this browser. No account, no awkward archaeological expedition.</p></div>{hostedRooms.length > visibleHostedRooms && <button type="button" onClick={() => setHistoryOpen(true)}>See all {hostedRooms.length} rooms →</button>}</div>
        <div className="hosted-room-grid">{hostedRooms.slice(0, visibleHostedRooms).map((room) => <article className="hosted-room-card" key={room.code}><div className="hosted-room-topline"><span className={`hosted-room-status ${room.status}`}>{room.status === "lobby" ? "🌙 LOBBY" : room.status === "live" ? "⚡ LIVE" : room.status === "ended" ? "🏁 ENDED" : "📼 SAVED"}</span><span>{hostedRoomDate(room.createdAt)}</span></div><h3>{room.title}</h3><strong className="hosted-room-code">{room.code}</strong><div className="hosted-room-actions"><a href={`/e/${room.code}/host`} onClick={() => rememberRoomOpened(room.code)}>🎛️ Host controls →</a><a href={`/e/${room.code}`} onClick={() => rememberRoomOpened(room.code)}>Guest view</a></div></article>)}</div>
      </section>}
      <footer className="landing-footer">
        <span>Chaos-ed by <a href="https://sromku.com" target="_blank" rel="noreferrer">@sromku ↗</a> and an AI Codex agent.</span>
        <nav aria-label="Legal links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span>SOTA unlocked. Common sense still in beta.</span>
      </footer>
      {historyOpen && <div className="hosted-history-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setHistoryOpen(false)}><section className="hosted-history-sheet" role="dialog" aria-modal="true" aria-labelledby="all-hosted-rooms-title"><div className="hosted-sheet-handle" aria-hidden="true" /><div className="hosted-sheet-heading"><div><p className="eyebrow">🗃️ THE HOST ARCHIVES</p><h2 id="all-hosted-rooms-title">All rooms from this browser</h2></div><button ref={closeHistoryRef} type="button" onClick={() => setHistoryOpen(false)} aria-label="Close hosted room history">×</button></div><div className="hosted-sheet-list">{hostedRooms.map((room) => <article key={room.code}><span className={`hosted-room-status ${room.status}`}>{room.status === "lobby" ? "🌙 LOBBY" : room.status === "live" ? "⚡ LIVE" : room.status === "ended" ? "🏁 ENDED" : "📼 SAVED"}</span><div><strong>{room.title}</strong><small>Room {room.code} · {hostedRoomDate(room.createdAt)}</small></div><a href={`/e/${room.code}/host`} onClick={() => { rememberRoomOpened(room.code); setHistoryOpen(false); }}>Open host →</a></article>)}</div><p className="hosted-sheet-note">🧠 Clear this browser’s site data and these shortcuts disappear. The actual event data is unaffected.</p></section></div>}
    </main>
  );
}
