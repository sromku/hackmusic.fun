"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type HostParty = {
  code: string;
  title: string;
  status: string;
  currentTrack: { title: string; artist: string; duration: string; color: string };
  people: Array<{ id: string; name: string; score: number; initials: string; color: string }>;
  reactions: Array<{ id: string; tone: "up" | "down" }>;
};

export default function HostPage() {
  const [party, setParty] = useState<HostParty | null>(null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioEnabledRef = useRef(false);
  const knownReactions = useRef<Set<string> | null>(null);

  function sayReaction(kind: "up" | "down") {
    if (!audioEnabledRef.current || !("speechSynthesis" in window)) return;
    const voice = new SpeechSynthesisUtterance(kind === "up" ? "Yeah!" : "Boo!");
    voice.rate = kind === "up" ? 1.25 : 0.75;
    voice.pitch = kind === "up" ? 1.55 : 0.55;
    voice.volume = 0.72;
    window.speechSynthesis.speak(voice);
  }

  function enableAudio() {
    audioEnabledRef.current = true;
    setAudioEnabled(true);
    setMessage("Reaction sounds are armed. Keep this page open.");
    if ("speechSynthesis" in window) {
      const warmup = new SpeechSynthesisUtterance("Party sounds ready!");
      warmup.volume = 0.5;
      window.speechSynthesis.speak(warmup);
    }
  }

  useEffect(() => {
    let active = true;
    const refresh = () => fetch("/api/party?code=LIME-42&participantId=p-you")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { party: HostParty }) => {
        if (!active) return;
        const nextIds = new Set(data.party.reactions.map((reaction) => reaction.id));
        if (knownReactions.current) {
          data.party.reactions
            .filter((reaction) => !knownReactions.current?.has(reaction.id))
            .reverse()
            .forEach((reaction) => sayReaction(reaction.tone));
        }
        knownReactions.current = nextIds;
        setParty(data.party);
      })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function control(action: "skip" | "end") {
    if (!pin) { setMessage("Enter the host PIN first."); return; }
    setBusy(true);
    const response = await fetch("/api/party", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, code: "LIME-42", participantId: "p-you", pin }),
    });
    const data = await response.json();
    setMessage(response.ok ? (action === "skip" ? "Skipped. The room will recover." : "Party ended. Scores are final.") : data.error);
    if (response.ok) setParty(data.party);
    setBusy(false);
  }

  if (!party) return <main className="host-shell"><p>Warming up the room…</p></main>;

  const cheers = party.reactions.filter((reaction) => reaction.tone === "up").length;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;

  return (
    <main className="host-shell">
      <header className="topbar">
        <Link className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></Link>
        <Link className="participant-link" href="/">Open participant page →</Link>
      </header>
      <p className="eyebrow">HOST CONTROL · ROOM {party.code}</p>
      <h1>{party.title}</h1>

      <div className="host-grid">
        <section className="host-now-card">
          <div className="section-kicker"><span>ON THE SPEAKER</span><span>{party.status.toUpperCase()}</span></div>
          <div className="host-track">
            <div className={`host-art ${party.currentTrack.color}`}>♪</div>
            <div><h2>{party.currentTrack.title}</h2><p>{party.currentTrack.artist} · {party.currentTrack.duration}</p></div>
          </div>
          <div className="host-reaction-counts">
            <div className="host-cheers"><strong>{cheers}</strong><span>CHEERS</span></div>
            <div className="host-boos"><strong>{boos}</strong><span>BOOS</span></div>
          </div>
        </section>

        <section className="host-controls-card">
          <div className="card-title-row"><h2>CONTROLS</h2><span>HOST ONLY</span></div>
          <label className="host-pin"><span>HOST PIN</span><input type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" /></label>
          <button className={`host-audio ${audioEnabled ? "armed" : ""}`} type="button" onClick={enableAudio}>{audioEnabled ? "✓ Reaction sounds armed" : "Enable reaction sounds"}</button>
          <button className="host-skip" type="button" disabled={busy} onClick={() => void control("skip")}>Skip to next song →</button>
          <button className="host-end" type="button" disabled={busy} onClick={() => void control("end")}>End party & freeze scores</button>
          {message && <p className="host-message" role="status">{message}</p>}
          <p className="host-hint">Demo PIN: <strong>4242</strong></p>
        </section>
      </div>

      <section className="leaderboard-card">
        <div className="card-title-row"><h2>LIVE SCOREBOARD</h2><span>{party.people.length} PLAYERS</span></div>
        <ol>
          {[...party.people].sort((a, b) => b.score - a.score).map((person, index) => (
            <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>
          ))}
        </ol>
      </section>
    </main>
  );
}
