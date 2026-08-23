import type { ReactNode } from "react";

type LegalSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type LegalPageProps = {
  eyebrow: string;
  title: string;
  summary: string;
  accent: "blue" | "mint";
  sections: LegalSection[];
};

export default function LegalPage({ eyebrow, title, summary, accent, sections }: LegalPageProps) {
  return (
    <main className={`legal-shell legal-${accent}`}>
      <header className="topbar legal-topbar">
        <a className="brand" href="/" aria-label="HackMusic home">
          <span className="brand-mark">HM</span>
          <span>HackMusic</span>
        </a>
        <a className="legal-home-link" href="/">← Back to the party</a>
      </header>

      <section className="legal-hero">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-summary">{summary}</p>
        </div>
        <aside className="legal-stamp" aria-label="Document details">
          <span>📍 NEW JERSEY</span>
          <strong>Plain-ish English.</strong>
          <small>Last updated August 22, 2026</small>
        </aside>
      </section>

      <div className="legal-layout">
        <nav className="legal-toc" aria-label={`${title} sections`}>
          <p>⚡ JUMP TO</p>
          {sections.map((section, index) => (
            <a href={`#${section.id}`} key={section.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {section.title}
            </a>
          ))}
        </nav>

        <article className="legal-document">
          {sections.map((section, index) => (
            <section id={section.id} className="legal-section" key={section.id}>
              <div className="legal-section-heading">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{section.title}</h2>
              </div>
              <div className="legal-copy">{section.content}</div>
            </section>
          ))}
        </article>
      </div>

      <footer className="legal-footer">
        <div>
          <strong>Still have a question?</strong>
          <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a>
        </div>
        <nav aria-label="Legal pages">
          <a href="/go-bigger">Go bigger</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/">Home</a>
        </nav>
      </footer>
    </main>
  );
}
