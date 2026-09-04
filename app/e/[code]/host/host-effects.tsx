"use client";

import { Component, type ReactNode } from "react";

export type HostBurst = {
  id: string;
  emoji: string;
  kind: "up" | "down" | "flair";
  /** Horizontal position as a percentage of the viewport width. */
  x: number;
  /** Slight per-particle drift and delay so a crowd of reactions does not move in lockstep. */
  drift: number;
  delay: number;
  avatar?: string;
};

export type HostAlert = {
  id: string;
  kind: "boo-warning" | "plug-pulled" | "streak" | "leader" | "shield";
  title: string;
  detail?: string;
};

const CHEER_EMOJIS = ["🙌", "🎉", "🔥", "✨", "💃", "🕺", "🎊"];
const BOO_EMOJIS = ["👻", "👎", "💀", "🍅", "🚫"];

export function burstEmojisFor(kind: "up" | "down") {
  const pool = kind === "up" ? CHEER_EMOJIS : BOO_EMOJIS;
  const count = 6 + Math.floor(Math.random() * 4);
  return Array.from({ length: count }, () => pool[Math.floor(Math.random() * pool.length)]);
}

export function makeBursts(kind: "up" | "down" | "flair", emojis: string[], avatar?: string): HostBurst[] {
  const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const center = 15 + Math.random() * 70;
  return emojis.map((emoji, index) => ({
    id: `${seed}-${index}`,
    emoji,
    kind,
    x: Math.max(3, Math.min(97, center + (Math.random() - 0.5) * 34)),
    drift: (Math.random() - 0.5) * 120,
    delay: Math.random() * 0.35,
    avatar: index === 0 ? avatar : undefined,
  }));
}

/** The overlay is decoration. If it ever throws, it disappears quietly and the player keeps going. */
export class HostEffectsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("HackMusic: host effects overlay disabled after an error.", error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function HostEffects({ bursts, alert, shaking, blackout }: { bursts: HostBurst[]; alert: HostAlert | null; shaking: boolean; blackout: boolean }) {
  return <div className={`host-effects ${shaking ? "shaking" : ""}`} aria-hidden="true">
    {bursts.map((burst) => <span
      className={`host-burst burst-${burst.kind}`}
      style={{ left: `${burst.x}%`, animationDelay: `${burst.delay}s`, ["--drift" as string]: `${burst.drift}px` }}
      key={burst.id}
    >{burst.emoji}{burst.avatar && <b>{burst.avatar}</b>}</span>)}
    {blackout && <div className="host-blackout" />}
    {alert && <div className={`host-alert alert-${alert.kind}`} key={alert.id}><strong>{alert.title}</strong>{alert.detail && <span>{alert.detail}</span>}</div>}
  </div>;
}
