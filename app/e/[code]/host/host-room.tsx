"use client";

import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

type HostParty = {
  code: string;
  title: string;
  status: "live" | "ended";
  currentTrack: { title: string; artist: string; duration: string; color: string } | null;
  people: Array<{ id: string; name: string; score: number; initials: string; color: string }>;
  reactions: Array<{ id: string; tone: "up" | "down" }>;
  queueCount: number;
};

export default function HostRoom({ code }: { code: string }) {
  const [party, setParty] = useState<HostParty | null>(null);
  const [participantId, setParticipantId] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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

  useEffect(() => {
    const participant = window.localStorage.getItem(`hackmusic:${code}:participant`) ?? "";
    const key = window.localStorage.getItem(`hackmusic:${code}:host`) ?? "";
    const url = `${window.location.origin}/e/${code}`;
    queueMicrotask(() => {
      setParticipantId(participant);
      setHostKey(key);
      setShareUrl(url);
      if (!participant || !key) setError("This browser did not create that room, so its host controls are locked.");
    });
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: "#151515", light: "#fffef9" } }).then(setQrUrl).catch(() => undefined);
  }, [code]);

  useEffect(() => {
    if (!participantId || !hostKey) return;
    let active = true;
    const refresh = () => fetch(`/api/party?code=${encodeURIComponent(code)}&participantId=${encodeURIComponent(participantId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load the room.");
        if (!active) return;
        const nextIds = new Set<string>(data.party.reactions.map((reaction: { id: string }) => reaction.id));
        if (knownReactions.current) {
          data.party.reactions.filter((reaction: { id: string }) => !knownReactions.current?.has(reaction.id)).reverse().forEach((reaction: { tone: "up" | "down" }) => sayReaction(reaction.tone));
        }
        knownReactions.current = nextIds;
        setParty(data.party);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load the room."); });
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [code, hostKey, participantId]);

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

  async function copyInvite() {
    try { await navigator.clipboard.writeText(shareUrl); setMessage("Invite URL copied."); }
    catch { setMessage("Copy the URL shown below."); }
  }

  async function shareInvite() {
    if (navigator.share) {
      await navigator.share({ title: party?.title ?? "HackMusic", text: `Join HackMusic room ${code}`, url: shareUrl });
    } else {
      await copyInvite();
    }
  }

  async function control(action: "skip" | "end") {
    setBusy(true);
    try {
      const response = await fetch("/api/party", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, code, participantId, pin: hostKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Host action failed.");
      setParty(data.party);
      setMessage(action === "skip" ? "Skipped. The room will recover." : "Party ended. Scores are final.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Host action failed."); }
    finally { setBusy(false); }
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">HOST KEY REQUIRED</p><h1>{error}</h1><Link href={`/e/${code}`}>Open the participant room →</Link><Link href="/">Create a new room →</Link></main>;
  if (!party) return <main className="loading-room"><span className="brand-mark">HM</span><p>Warming up room {code}…</p></main>;

  const cheers = party.reactions.filter((reaction) => reaction.tone === "up").length;
  const boos = party.reactions.filter((reaction) => reaction.tone === "down").length;
  return <main className="host-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Host</span></Link><Link className="participant-link" href={`/e/${code}`}>Open participant page →</Link></header>
    <div className="host-heading"><div><p className="eyebrow">HOST CONTROL · ROOM {party.code}</p><h1>{party.title}</h1></div><span className={`host-status ${party.status}`}>{party.status === "ended" ? "PARTY ENDED" : "LIVE"}</span></div>

    <section className="share-room-card"><div className="share-code"><span>ROOM CODE</span><strong>{party.code}</strong><p>{shareUrl}</p><div><button type="button" onClick={() => void copyInvite()}>Copy invite</button><button type="button" onClick={() => void shareInvite()}>Share</button></div></div>{qrUrl && <Image unoptimized src={qrUrl} width={180} height={180} alt={`QR code to join room ${party.code}`} />}</section>

    <div className="host-grid"><section className="host-now-card"><div className="section-kicker"><span>ON THE SPEAKER</span><span>{party.queueCount} WAITING</span></div>{party.currentTrack ? <><div className="host-track"><div className={`host-art ${party.currentTrack.color}`}>♪</div><div><h2>{party.currentTrack.title}</h2><p>{party.currentTrack.artist} · {party.currentTrack.duration}</p></div></div><div className="host-reaction-counts"><div className="host-cheers"><strong>{cheers}</strong><span>CHEERS</span></div><div className="host-boos"><strong>{boos}</strong><span>BOOS</span></div></div></> : <div className="host-empty"><strong>No song yet.</strong><p>Open the participant page and add the first one.</p></div>}</section>
      <section className="host-controls-card"><div className="card-title-row"><h2>CONTROLS</h2><span>THIS PHONE ONLY</span></div><button className={`host-audio ${audioEnabled ? "armed" : ""}`} type="button" onClick={enableAudio}>{audioEnabled ? "✓ Reaction sounds armed" : "Enable reaction sounds"}</button><button className="host-skip" type="button" disabled={busy || !party.currentTrack || party.status === "ended"} onClick={() => void control("skip")}>Skip to next song →</button><button className="host-end" type="button" disabled={busy || party.status === "ended"} onClick={() => void control("end")}>End party & freeze scores</button>{message && <p className="host-message" role="status">{message}</p>}<p className="host-hint">The secret host key stays on the phone that created this room.</p></section>
    </div>
    <section className="leaderboard-card"><div className="card-title-row"><h2>{party.status === "ended" ? "FINAL SCOREBOARD" : "LIVE SCOREBOARD"}</h2><span>{party.people.length} PLAYERS</span></div><ol>{[...party.people].sort((a, b) => b.score - a.score).map((person, index) => <li key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><b>{index + 1}</b><strong>{person.name}</strong><span>{person.score} pts</span></li>)}</ol></section>
  </main>;
}
