"use client";

import { useEffect, useState } from "react";
import { participantStorageKey } from "../../../lib/party-storage";

const MAX_GUESTS = 8;

export default function LabRoom({ code }: { code: string }) {
  const [guestCount, setGuestCount] = useState(4);
  const [passcode, setPasscode] = useState("");
  const [showHost, setShowHost] = useState(true);
  const [hostKeyPresent, setHostKeyPresent] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const savedCount = Number(window.localStorage.getItem("hackmusic:lab:guests") ?? "4");
    const savedPasscode = window.localStorage.getItem(`hackmusic:${code}:joinPasscode`) ?? window.localStorage.getItem("hackmusic:lab:passcode") ?? "";
    const hostKey = window.localStorage.getItem(`hackmusic:${code}:host`) ?? "";
    queueMicrotask(() => {
      if (Number.isInteger(savedCount) && savedCount >= 1 && savedCount <= MAX_GUESTS) setGuestCount(savedCount);
      setPasscode(savedPasscode);
      setHostKeyPresent(Boolean(hostKey));
      setOrigin(window.location.origin);
    });
  }, [code]);

  function updateGuestCount(next: number) {
    const clamped = Math.max(1, Math.min(MAX_GUESTS, next));
    setGuestCount(clamped);
    window.localStorage.setItem("hackmusic:lab:guests", String(clamped));
  }

  function updatePasscode(next: string) {
    const clean = next.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    setPasscode(clean);
    window.localStorage.setItem("hackmusic:lab:passcode", clean);
  }

  function forgetGuests() {
    for (let index = 1; index <= MAX_GUESTS; index += 1) window.localStorage.removeItem(participantStorageKey(code, `guest-${index}`));
    setReloadToken((value) => value + 1);
  }

  const guestUrl = (index: number) => `/e/${code}?persona=guest-${index}${passcode ? `&passcode=${encodeURIComponent(passcode)}` : ""}`;
  const guests = Array.from({ length: guestCount }, (_, index) => index + 1);

  return <main className="lab-shell">
    <header className="lab-topbar">
      <a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Test Lab</span></a>
      <p>Room <strong>{code}</strong> · one browser, many humans. Each frame is a separate guest with its own identity.</p>
    </header>
    <section className="lab-controls" aria-label="Lab controls">
      <div className="lab-counter" role="group" aria-label="Guest frames"><span>GUEST FRAMES</span><div><button type="button" onClick={() => updateGuestCount(guestCount - 1)} aria-label="Fewer guests">−</button><strong>{guestCount}</strong><button type="button" onClick={() => updateGuestCount(guestCount + 1)} aria-label="More guests">+</button></div></div>
      <label htmlFor="lab-passcode">ROOM PASSCODE (PRE-FILLS THE JOIN FORM)<input id="lab-passcode" value={passcode} onChange={(event) => updatePasscode(event.target.value)} placeholder="e.g. VIBE42" autoComplete="off" /></label>
      <label className="lab-toggle"><input type="checkbox" checked={showHost} onChange={(event) => setShowHost(event.target.checked)} />Show the host frame{!hostKeyPresent && <small>This browser holds no host key for {code}. Create the room here, or open the host page in a tab instead.</small>}</label>
      <div className="lab-actions">
        <button type="button" onClick={() => setReloadToken((value) => value + 1)}>↻ Reload frames</button>
        <button type="button" onClick={forgetGuests}>🧹 Forget test guests</button>
        <a href={`/e/${code}/host`} target="_blank" rel="noreferrer">Host page in a tab ↗</a>
      </div>
      <p className="lab-note">🔒 Development only: this page and test personas exist on localhost and private-network addresses, and return 404 in production. 🧪 Personas only change where this browser stores each guest&apos;s id. The server still enforces the passcode, one vote per song, and every other rule. To test on separate phones instead, share the normal invite. Sounds and video play inside the host frame; click it once so the browser allows audio.</p>
    </section>
    <section className={`lab-grid ${showHost ? "with-host" : ""}`}>
      {showHost && <article className="lab-frame lab-host">
        <div className="lab-frame-bar"><strong>🎛️ Host</strong><a href={`/e/${code}/host`} target="_blank" rel="noreferrer">Open in tab ↗</a></div>
        <iframe src={`/e/${code}/host`} title={`Host page for room ${code}`} allow="autoplay; encrypted-media; screen-wake-lock" key={`host-${reloadToken}`} />
      </article>}
      {guests.map((index) => <article className="lab-frame" key={`guest-${index}-${reloadToken}`}>
        <div className="lab-frame-bar"><strong>🧑‍🎤 Guest {index}</strong><a href={guestUrl(index)} target="_blank" rel="noreferrer">Open in tab ↗</a></div>
        <iframe src={guestUrl(index)} title={`Guest ${index} view of room ${code}`} />
      </article>)}
    </section>
    <footer className="lab-footer"><span>Direct links for phones or extra tabs:</span>{guests.map((index) => <code key={index}>{origin}{guestUrl(index)}</code>)}</footer>
  </main>;
}
