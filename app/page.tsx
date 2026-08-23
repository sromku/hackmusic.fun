"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [hostName, setHostName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [preParty, setPreParty] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
        <Link className="brand" href="/" aria-label="HackMusic home"><span className="brand-mark">HM</span><span>HackMusic</span></Link>
        <span className="landing-tag">🎉 PRIVATE PARTIES · 🔊 LOUD OPINIONS</span>
      </header>
      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">🎮 THE PLAYLIST IS NOW A PARTY GAME</p>
          <h1>Let the room<br />pick the vibe.</h1>
          <p className="landing-lede">Create a room, invite the humans, and hand everyone a tiny amount of power over the speaker.</p>
          <div className="landing-energy" aria-label="Made for six to thirty people sharing one speaker">
            <span className="energy-orb" aria-hidden="true">🪩</span>
            <div><strong>6–30 HUMANS · ONE SPEAKER</strong><small>Zero playlist dictators.</small></div>
            <span className="energy-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          </div>
          <section className="landing-how" aria-labelledby="how-it-works-title">
            <div className="landing-how-heading"><strong id="how-it-works-title">THREE MOVES. MAXIMUM DRAMA.</strong><span>⚡ instant party rules</span></div>
            <div className="landing-rules">
              <article className="landing-rule rule-song"><span className="rule-step">01</span><span className="rule-icon" aria-hidden="true">🎵</span><div><strong>Drop a secret song</strong><small>Paste a Spotify track. Nobody sees what’s next.</small></div></article>
              <article className="landing-rule rule-react"><span className="rule-step">02</span><span className="rule-icon" aria-hidden="true">🙌</span><div><strong>React out loud</strong><small>Cheers give +3. Boos stay completely anonymous.</small></div></article>
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
            <button type="submit" disabled={busy}>🚪 Join →</button>
          </form>
          {message && <p className="landing-message" role="alert">{message}</p>}
          <p className="entry-legal-note">By creating or joining a room, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</p>
        </div>
      </section>
      <footer className="landing-footer">
        <span>Chaos-ed by <a href="https://sromku.com" target="_blank" rel="noreferrer">@sromku ↗</a> and an AI Codex agent.</span>
        <nav aria-label="Legal links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span>SOTA unlocked. Common sense still in beta.</span>
      </footer>
    </main>
  );
}
