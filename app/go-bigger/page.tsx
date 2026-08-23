import type { Metadata } from "next";
import { SITE_NAME, SITE_URL } from "../site";

const contactEmail = "hackmusic.fun@gmail.com";
const contactSubject = "HackMusic — let’s go bigger";
const contactBody = `Hi Roman,

I want to use HackMusic for something bigger.

Event or venue:
Approximate number of humans:
Date and location:
What we want customized:

The non-chaotic details:`;
const contactHref = `mailto:${contactEmail}?subject=${encodeURIComponent(contactSubject)}&body=${encodeURIComponent(contactBody)}`;

const description = "Custom HackMusic experiences for restaurants, company events, venues, conferences, and ambitious parties.";

export const metadata: Metadata = {
  title: "Go Bigger",
  description,
  alternates: { canonical: `${SITE_URL}/go-bigger` },
  openGraph: { title: `Go Bigger with ${SITE_NAME}`, description, url: `${SITE_URL}/go-bigger`, images: [] },
  twitter: { title: `Go Bigger with ${SITE_NAME}`, description, images: [] },
};

const possibilities = [
  { icon: "🍽️", title: "Restaurants & bars", copy: "Turn the room into the DJ without surrendering the aux cable to one suspiciously confident table." },
  { icon: "🏢", title: "Company events", copy: "Branded rooms, team rules, bigger crowds, and a playlist people actually participate in." },
  { icon: "🎪", title: "Venues & conferences", copy: "A tailored setup for your screens, flow, moderation needs, and delightfully specific flavor of chaos." },
];

const customIdeas = [
  "Your colors, logo, language, and event personality",
  "Different queue, voting, scoring, or moderation rules",
  "Larger rooms and event-specific reliability planning",
  "Dedicated deployment, integrations, or hands-on setup",
  "A recurring format for venues, teams, or event series",
  "Something weird we have not thought of yet — excellent",
];

export default function GoBiggerPage() {
  return (
    <main className="bigger-shell">
      <div className="shape shape-one" aria-hidden="true" />
      <div className="shape shape-two" aria-hidden="true" />
      <div className="shape shape-three" aria-hidden="true" />

      <header className="topbar bigger-topbar">
        <a className="brand" href="/" aria-label="HackMusic home">
          <span className="brand-mark">HM</span>
          <span>HackMusic</span>
        </a>
        <a className="bigger-home-link" href="/">← Back to small-ish chaos</a>
      </header>

      <section className="bigger-hero">
        <div className="bigger-hero-copy">
          <p className="eyebrow">🏟️ THE LIVING ROOM WAS ONLY THE PILOT</p>
          <h1>Go bigger.<br /><span>Keep the chaos.</span></h1>
          <p>Running a restaurant, company event, conference, venue, or a party with its own gravitational field? Let’s make HackMusic fit the room instead of making the room fit the app.</p>
          <a className="bigger-primary-cta" href={contactHref}>Tell us your grand scheme →</a>
          <small>Opens your email app. No CRM labyrinth. No “book a synergy discovery ritual.”</small>
        </div>
        <aside className="bigger-price-card">
          <span>💸 EXTREMELY TRANSPARENT PRICING</span>
          <strong>“It depends.”</strong>
          <p>The price depends on the crowd, customization, support, and deployment. We discuss the useful version first, then put an honest number on it.</p>
          <div><b>01</b> You describe the beautiful problem.</div>
          <div><b>02</b> We decide if this is sensible.</div>
          <div><b>03</b> Scope, price, ship, noise.</div>
        </aside>
      </section>

      <section className="bigger-for" aria-labelledby="bigger-for-title">
        <div className="bigger-section-heading">
          <p className="eyebrow">🪩 MORE HUMANS. MORE OPINIONS.</p>
          <h2 id="bigger-for-title">Built around your room.</h2>
        </div>
        <div className="bigger-audience-grid">
          {possibilities.map((item, index) => (
            <article key={item.title}>
              <span className="bigger-card-number">0{index + 1}</span>
              <span className="bigger-card-icon" aria-hidden="true">{item.icon}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bigger-custom">
        <div>
          <p className="eyebrow">🧪 THE CUSTOMIZATION MENU</p>
          <h2>Same game.<br />Your rules.</h2>
          <p>HackMusic can be shaped around a one-off event or an ongoing experience. These are possibilities, not a suspiciously rigid package disguised as flexibility.</p>
        </div>
        <ul>
          {customIdeas.map((idea, index) => <li key={idea}><span>{String(index + 1).padStart(2, "0")}</span>{idea}</li>)}
        </ul>
      </section>

      <section className="bigger-final-cta">
        <span className="bigger-final-icon" aria-hidden="true">📨</span>
        <div>
          <p className="eyebrow">READY TO MAKE A RESPONSIBLE AMOUNT OF TROUBLE?</p>
          <h2>Bring the crowd.<br />We’ll discuss the machinery.</h2>
          <p>Email a rough headcount, date, location, and the custom thing living in your imagination. Half-formed ideas are welcome. So are alarmingly detailed spreadsheets.</p>
        </div>
        <div className="bigger-contact-actions">
          <a href={contactHref}>Email Roman →</a>
          <span>{contactEmail}</span>
          <small>No commitment. No sales robot pretending to be Kevin.</small>
        </div>
      </section>

      <footer className="bigger-footer">
        <span>Scrambled by <a href="https://sromku.com" target="_blank" rel="noreferrer">@sromku</a> + AI Codex agent</span>
        <nav aria-label="Site links"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
        <span>Custom chaos. Sensibly invoiced.</span>
      </footer>
    </main>
  );
}
