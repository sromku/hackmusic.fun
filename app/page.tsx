"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [hostName, setHostName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/party", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", title: eventName, name: hostName }),
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
          <div className="landing-rules" aria-label="How HackMusic works">
            <span><b>01</b> 🎵 Add secret songs</span><span><b>02</b> 🙌 Cheer or 👻 boo</span><span><b>03</b> ⏭️ Three boos skip</span>
          </div>
        </div>
        <div className="room-entry-stack">
          <form className="entry-card create-card" onSubmit={createRoom}>
            <p className="eyebrow">⚡ START THE CHAOS</p><h2>Create a room</h2>
            <label htmlFor="event-name">EVENT NAME</label><input id="event-name" value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={60} placeholder="Friday night hackathon" required />
            <label htmlFor="host-name">YOUR NAME</label><input id="host-name" value={hostName} onChange={(event) => setHostName(event.target.value)} maxLength={24} placeholder="The brave host" required />
            <button type="submit" disabled={busy}>{busy ? "🛠️ Making room…" : "🎉 Create my room →"}</button>
          </form>
          <form className="entry-card join-room-card" onSubmit={joinRoom}>
            <div><p className="eyebrow">🎟️ GOT A CODE?</p><h2>Join the room</h2></div>
            <label className="sr-only" htmlFor="room-code">Room code</label><input id="room-code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={6} placeholder="ABC123" required />
            <button type="submit" disabled={busy}>🚪 Join →</button>
          </form>
          {message && <p className="landing-message" role="alert">{message}</p>}
        </div>
      </section>
      <footer className="landing-footer"><span>⭐ 30 points each</span><span>🙌 Names on cheers</span><span>👻 Boos stay anonymous</span></footer>
    </main>
  );
}
