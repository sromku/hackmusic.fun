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
const partyLessons = [
  {
    id: 0,
    number: "01",
    icon: "🎵",
    tone: "song",
    kicker: "THE SECRET DROP",
    title: "Feed the mystery.",
    shout: "ADD A SONG. TELL NOBODY.",
    body: "Join the private party, pick a human name, and paste a Spotify or YouTube link. It disappears into a hidden queue. No peeking. No lobbying the DJ. No twelve-person committee meeting about tempo.",
    equation: ["YOU", "+", "SPOTIFY OR YOUTUBE LINK", "→", "SECRET QUEUE"],
    footnote: "The host sees the queue. The humans see suspense.",
  },
  {
    id: 1,
    number: "02",
    icon: "🙌",
    tone: "react",
    kicker: "FEELINGS, BUT AUDIBLE",
    title: "React out loud.",
    shout: "CHEER IT. BOO IT. COMMIT.",
    body: "Cheer and the host speaker ducks the music, fires a ridiculous happy sound, and gives the song picker +3. Boo and it fires an equally ridiculous complaint, removes 3 points, and keeps your identity gloriously anonymous until the party ends. Then the receipts come out.",
    equation: ["CHEER = +3 + YEAH!", "⚡", "BOO = −3 + BOOO!"],
    footnote: "One human. One vote per song. Democracy has guardrails now.",
  },
  {
    id: 2,
    number: "03",
    icon: "⏭️",
    tone: "skip",
    kicker: "THE CROWD HAS SPOKEN",
    title: "Three boos. Gone.",
    shout: "THIRD BOO PULLS THE PLUG.",
    body: "When three different humans boo the current song, playback stops and the next secret pick starts. When the party ends, every score is revealed and selective memory becomes the official after-party policy.",
    equation: ["👻", "+", "👻", "+", "👻", "=", "NEXT SONG ⏭️"],
    footnote: "Final scores unlock at the end. Bragging may continue indefinitely.",
  },
] as const;

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
  const [roomPasscode, setRoomPasscode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [preParty, setPreParty] = useState(false);
  const [musicSource, setMusicSource] = useState<"spotify" | "youtube">("spotify");
  const [scheduledFor, setScheduledFor] = useState("");
  const [hostedRooms, setHostedRooms] = useState<HostedRoom[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lessonOpen, setLessonOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const closeHistoryRef = useRef<HTMLButtonElement | null>(null);
  const closeLessonRef = useRef<HTMLButtonElement | null>(null);
  const lessonDialogRef = useRef<HTMLElement | null>(null);
  const lessonTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lessonVisible = lessonOpen !== null;
  const activeLesson = lessonOpen === null ? null : partyLessons[lessonOpen];

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

  useEffect(() => {
    if (!lessonVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeLessonRef.current?.focus());
    const handleLessonKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLessonOpen(null);
      if (event.key === "ArrowRight") setLessonOpen((current) => current === null ? null : (current + 1) % partyLessons.length);
      if (event.key === "ArrowLeft") setLessonOpen((current) => current === null ? null : (current + partyLessons.length - 1) % partyLessons.length);
      if (event.key !== "Tab") return;
      const focusable = lessonDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleLessonKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleLessonKeys);
      window.requestAnimationFrame(() => lessonTriggerRef.current?.focus());
    };
  }, [lessonVisible]);

  function openLesson(index: number, trigger: HTMLButtonElement) {
    lessonTriggerRef.current = trigger;
    setLessonOpen(index);
  }

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
        body: JSON.stringify({ action: "create", title: eventName, name: hostName, passcode: roomPasscode, musicSource, preParty, scheduledFor: scheduledDate?.toISOString(), website: String(form.get("website") ?? "") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not create the room.");
      const code = data.room.code as string;
      window.localStorage.setItem(`hackmusic:${code}:participant`, data.room.participantId);
      window.localStorage.setItem(`hackmusic:${code}:host`, data.room.hostKey);
      window.localStorage.setItem(`hackmusic:${code}:joinPasscode`, roomPasscode.trim().toUpperCase());
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
        <div className="landing-top-actions"><span className="landing-tag">🎉 PRIVATE PARTIES · 🔊 LOUD OPINIONS</span><a href="/go-bigger">🏟️ GO BIGGER →</a></div>
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
            <div className="landing-how-heading"><strong id="how-it-works-title">THREE MOVES. MAXIMUM DRAMA.</strong><span>⚡ tap a rule · become dangerous</span></div>
            <div className="landing-rules">
              <button type="button" className="landing-rule rule-song" aria-haspopup="dialog" onClick={(event) => openLesson(0, event.currentTarget)}><span className="rule-step">01</span><span className="rule-icon" aria-hidden="true">🎵</span><div><strong>Drop a secret song</strong><small>Paste a Spotify or YouTube link. Nobody sees what’s next.</small></div><em>OPEN THE MANUAL ↗</em></button>
              <span className="rule-connector" aria-hidden="true">→</span>
              <button type="button" className="landing-rule rule-react" aria-haspopup="dialog" onClick={(event) => openLesson(1, event.currentTarget)}><span className="rule-step">02</span><span className="rule-icon" aria-hidden="true">🙌</span><div><strong>React out loud</strong><small>Cheers give +3. Boos stay completely anonymous.</small></div><em>OPEN THE MANUAL ↗</em></button>
              <span className="rule-connector" aria-hidden="true">→</span>
              <button type="button" className="landing-rule rule-skip" aria-haspopup="dialog" onClick={(event) => openLesson(2, event.currentTarget)}><span className="rule-step">03</span><span className="rule-icon" aria-hidden="true">⏭️</span><div><strong>The crowd can skip</strong><small>Three boos and the next secret song starts.</small></div><em>OPEN THE MANUAL ↗</em></button>
            </div>
          </section>
          <section className="landing-sources" aria-labelledby="sources-title">
            <div className="landing-how-heading"><strong id="sources-title">TWO FLAVORS OF ROOM. ONE SPEAKER.</strong><span>🔒 pick once · locked all night</span></div>
            <div className="source-cards">
              <article className="source-card source-spotify"><span className="source-icon" aria-hidden="true">🟢</span><div><h3>Spotify room</h3><p>Full tracks, no previews, no ads. The host connects one Spotify Premium account and becomes the speaker. Guests paste Spotify song links. That’s the entire ritual.</p><small>HOST NEEDS PREMIUM · GUESTS NEED NOTHING</small></div></article>
              <article className="source-card source-youtube"><span className="source-icon" aria-hidden="true">▶️</span><div><h3>YouTube room</h3><p>Videos play right on the host screen. Zero accounts, zero setup, one tap to start. Guests paste YouTube links, even the ones dragging 47 tracking parameters behind them.</p><small>NOBODY NEEDS AN ACCOUNT · PLAYLISTS POLITELY DECLINED</small></div></article>
            </div>
          </section>
        </div>
        <div className="room-entry-stack">
          <form className="entry-card create-card" onSubmit={createRoom}>
            <div className="entry-card-top"><p className="eyebrow">⚡ START THE CHAOS</p><span>NO APP NEEDED</span></div><h2>Create a room</h2>
            <label htmlFor="event-name">EVENT NAME</label><input id="event-name" value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={60} placeholder="Friday night hackathon" required />
            <label htmlFor="host-name">YOUR NAME</label><input id="host-name" value={hostName} onChange={(event) => setHostName(event.target.value)} maxLength={24} placeholder="The brave host" required />
            <label htmlFor="room-passcode">ROOM PASSCODE</label><input id="room-passcode" value={roomPasscode} onChange={(event) => setRoomPasscode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} minLength={4} maxLength={12} autoComplete="new-password" placeholder="e.g. VIBE42" required /><small className="passcode-hint">🔐 Guests need the room code <em>and</em> this passcode. It never appears in the invite URL.</small>
            <fieldset className="room-start-picker room-source-picker"><legend>WHERE DOES THE MUSIC COME FROM?</legend><div>
              <button className={musicSource === "spotify" ? "active" : ""} type="button" aria-pressed={musicSource === "spotify"} onClick={() => setMusicSource("spotify")}><span>🟢</span><strong>Spotify</strong><small>Full tracks. Host needs Spotify Premium.</small></button>
              <button className={musicSource === "youtube" ? "active" : ""} type="button" aria-pressed={musicSource === "youtube"} onClick={() => setMusicSource("youtube")}><span>▶️</span><strong>YouTube</strong><small>Videos play on the host screen. No account.</small></button>
            </div><small className="source-hint">🔒 Locked for the whole event. Guests can only add {musicSource === "spotify" ? "Spotify tracks" : "YouTube videos"}.</small></fieldset>
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
        <span>Scrambled by <a href="https://sromku.com" target="_blank" rel="noreferrer">@sromku</a> + AI Codex agent</span>
        <nav aria-label="Site links"><a href="/go-bigger">Go bigger</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span>AGI unlocked. Common sense still in beta.</span>
      </footer>
      {historyOpen && <div className="hosted-history-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setHistoryOpen(false)}><section className="hosted-history-sheet" role="dialog" aria-modal="true" aria-labelledby="all-hosted-rooms-title"><div className="hosted-sheet-handle" aria-hidden="true" /><div className="hosted-sheet-heading"><div><p className="eyebrow">🗃️ THE HOST ARCHIVES</p><h2 id="all-hosted-rooms-title">All rooms from this browser</h2></div><button ref={closeHistoryRef} type="button" onClick={() => setHistoryOpen(false)} aria-label="Close hosted room history">×</button></div><div className="hosted-sheet-list">{hostedRooms.map((room) => <article key={room.code}><span className={`hosted-room-status ${room.status}`}>{room.status === "lobby" ? "🌙 LOBBY" : room.status === "live" ? "⚡ LIVE" : room.status === "ended" ? "🏁 ENDED" : "📼 SAVED"}</span><div><strong>{room.title}</strong><small>Room {room.code} · {hostedRoomDate(room.createdAt)}</small></div><a href={`/e/${room.code}/host`} onClick={() => { rememberRoomOpened(room.code); setHistoryOpen(false); }}>Open host →</a></article>)}</div><p className="hosted-sheet-note">🧠 Clear this browser’s site data and these shortcuts disappear. The actual event data is unaffected.</p></section></div>}

      {activeLesson && <div className="party-lesson-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setLessonOpen(null)}><section ref={lessonDialogRef} className={`party-lesson lesson-${activeLesson.tone}`} role="dialog" aria-modal="true" aria-labelledby="party-lesson-title"><div className="party-lesson-handle" aria-hidden="true" /><div className="lesson-chaos lesson-chaos-one" aria-hidden="true" /><div className="lesson-chaos lesson-chaos-two" aria-hidden="true" /><span className="lesson-giant-number" aria-hidden="true">{activeLesson.number}</span><header className="party-lesson-header"><div><span>{activeLesson.icon}</span><strong>HACKMUSIC FIELD MANUAL · {activeLesson.number}/03</strong></div><button ref={closeLessonRef} type="button" onClick={() => setLessonOpen(null)} aria-label="Close party instructions">×</button></header><div className="party-lesson-copy"><p>{activeLesson.kicker}</p><h2 id="party-lesson-title">{activeLesson.title}</h2><strong>{activeLesson.shout}</strong><p>{activeLesson.body}</p><div className="lesson-equation" aria-label={activeLesson.equation.join(" ")}>{activeLesson.equation.map((part, index) => <span key={`${part}-${index}`}>{part}</span>)}</div><small>{activeLesson.footnote}</small></div><footer className="party-lesson-footer"><nav aria-label="Party instruction steps">{partyLessons.map((lesson) => <button key={lesson.number} type="button" className={lesson.id === activeLesson.id ? "active" : ""} aria-label={`Open instruction ${lesson.number}: ${lesson.title}`} aria-current={lesson.id === activeLesson.id ? "step" : undefined} onClick={() => setLessonOpen(lesson.id)}><span>{lesson.number}</span>{lesson.icon}</button>)}</nav><button type="button" onClick={() => setLessonOpen((activeLesson.id + 1) % partyLessons.length)}>{activeLesson.id === partyLessons.length - 1 ? "REPLAY THE CHAOS ↺" : "NEXT BAD IDEA →"}</button></footer></section></div>}
    </main>
  );
}
