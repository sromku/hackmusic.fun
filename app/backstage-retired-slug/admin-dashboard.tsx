"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { encryptBackupSnapshot } from "../../lib/backup-encryption";

type AdminOverview = {
  generatedAt: string;
  totals: { rooms: number; liveRooms: number; participants: number; tracks: number; reactions: number };
  partyPulse: {
    periodDays: number;
    timezone: string;
    startDate: string;
    endDate: string;
    totals: { rooms: number; humans: number; tracks: number; songStarts: number; cheers: number; boos: number; reactions: number; activeRooms: number };
    trend: PartyPulseDay[];
  };
  analytics: {
    periodDays: number;
    retentionDays: number;
    pageViews: number;
    visits: number;
    previousPageViews: number;
    previousVisits: number;
    retainedPageViews: number;
    trend: Array<{ day: string; pageViews: number; visits: number }>;
    topPages: AnalyticsBreakdownRow[];
    referrers: AnalyticsBreakdownRow[];
    devices: AnalyticsBreakdownRow[];
    countries: AnalyticsBreakdownRow[];
  };
  rooms: Array<{ code: string; title: string; status: string; queueMode: string; createdAt: string; currentTrack: string | null; participants: number; tracks: number; reactions: number }>;
};

type AnalyticsBreakdownRow = { label: string; count: number; percent: number };
type PartyPulseDay = { day: string; rooms: number; humans: number; tracks: number; songStarts: number; cheers: number; boos: number; reactions: number; activeRooms: number };

type AdminRoom = {
  room: { code: string; title: string; status: string; queueMode: string; scheduledFor: string | null; createdAt: string };
  participants: Array<{ name: string; score: number; joinedAt: string }>;
  submissions: Array<{ title: string; artist: string; duration: string; status: string; skipReason: string | null; skipPercent: number | null; submittedBy: string; submittedAt: string }>;
  reactions: Array<{ kind: string; actor: string; track: string; createdAt: string }>;
  activity: Array<{ kind: string; actor: string | null; track: string | null; createdAt: string }>;
};

type BackupResponse = {
  backup: {
    exportedAt: string;
    counts: Record<string, number>;
    [key: string]: unknown;
  };
};

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

async function requestAdmin<T>(search = "") {
  const response = await fetch(`/api/backstage-retired-slug${search}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not read HackMusic data.");
  return data as T;
}

function DataTable({ columns, rows }: { columns: Array<{ key: string; label: string; format?: (value: unknown, row: Record<string, unknown>) => string }>; rows: object[] }) {
  if (!rows.length) return <p className="admin-empty">Nothing here yet.</p>;
  return <div className="admin-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((item, index) => { const row = item as Record<string, unknown>; return <tr key={index}>{columns.map((column) => <td key={column.key}>{column.format ? column.format(row[column.key], row) : String(row[column.key] ?? "—")}</td>)}</tr>; })}</tbody></table></div>;
}

function number(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

function comparison(current: number, previous: number) {
  if (!previous) return current ? "New this period" : "No traffic yet";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : ""}${change}% vs prior 30d`;
}

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function PartyPulseTrend({ rows }: { rows: PartyPulseDay[] }) {
  const totals = rows.map((row) => row.rooms + row.humans + row.tracks + row.reactions);
  const maximum = Math.max(1, ...totals);
  return <section className="admin-panel admin-pulse-trend">
    <div className="admin-panel-title"><h3>🫀 Daily party activity</h3><span>Rooms / humans / tracks / reactions</span></div>
    <div className="admin-pulse-legend" aria-hidden="true"><span><i className="rooms" />Rooms</span><span><i className="humans" />Humans</span><span><i className="tracks" />Tracks</span><span><i className="reactions" />Reactions</span></div>
    <div className="admin-pulse-bars">
      {rows.map((row, index) => {
        const total = totals[index];
        return <div className="admin-pulse-day" key={row.day} title={`${row.day}: ${row.rooms} rooms, ${row.humans} humans, ${row.tracks} tracks, ${row.songStarts} song starts, ${row.cheers} cheers, ${row.boos} boos, ${row.activeRooms} active rooms`}>
          <span className="admin-pulse-count">{total}</span>
          <span className="admin-pulse-bar" style={{ height: `${total ? Math.max(4, Math.round((total / maximum) * 100)) : 2}%` }}>
            {row.rooms > 0 && <i className="rooms" style={{ flexGrow: row.rooms }} />}
            {row.humans > 0 && <i className="humans" style={{ flexGrow: row.humans }} />}
            {row.tracks > 0 && <i className="tracks" style={{ flexGrow: row.tracks }} />}
            {row.reactions > 0 && <i className="reactions" style={{ flexGrow: row.reactions }} />}
          </span>
          <time dateTime={row.day}>{shortDay(row.day)}</time>
        </div>;
      })}
    </div>
  </section>;
}

function TrafficTrend({ rows }: { rows: AdminOverview["analytics"]["trend"] }) {
  const maximum = Math.max(1, ...rows.map((row) => row.pageViews));
  return <section className="admin-panel admin-traffic-trend">
    <div className="admin-panel-title"><h3>📈 Daily traffic</h3><span>Page views / visits</span></div>
    <div className="admin-traffic-bars">
      {rows.map((row) => <div className="admin-traffic-day" key={row.day} title={`${row.day}: ${row.pageViews} page views, ${row.visits} visits`}>
        <span className="admin-traffic-count">{row.pageViews}</span>
        <span className="admin-traffic-bar" style={{ height: `${Math.max(3, Math.round((row.pageViews / maximum) * 100))}%` }} />
        <time dateTime={row.day}>{new Date(`${row.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</time>
      </div>)}
    </div>
  </section>;
}

function AnalyticsBreakdown({ title, note, rows }: { title: string; note: string; rows: AnalyticsBreakdownRow[] }) {
  return <section className="admin-panel admin-analytics-breakdown">
    <div className="admin-panel-title"><h3>{title}</h3><span>{note}</span></div>
    {rows.length ? <ol>{rows.map((row) => <li key={row.label}>
      <span title={row.label}>{row.label}</span><span className="admin-breakdown-meter"><i style={{ width: `${Math.max(2, row.percent)}%` }} /></span><strong>{number(row.count)} <small>{row.percent}%</small></strong>
    </li>)}</ol> : <p className="admin-empty">Traffic will appear here after the first production visit.</p>}
  </section>;
}

export default function AdminDashboard({ ownerEmail, signOutPath }: { ownerEmail: string; signOutPath: string }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [selected, setSelected] = useState<AdminRoom | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupConfirmation, setBackupConfirmation] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try { setOverview(await requestAdmin<AdminOverview>()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load admin data."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    requestAdmin<AdminOverview>()
      .then((data) => { if (active) setOverview(data); })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load admin data."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const rooms = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (overview?.rooms ?? []).filter((room) => !query || room.code.toLowerCase().includes(query) || room.title.toLowerCase().includes(query));
  }, [overview, search]);

  async function openRoom(code: string) {
    setLoading(true);
    setMessage("");
    try { setSelected(await requestAdmin<AdminRoom>(`?code=${encodeURIComponent(code)}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load that room."); }
    finally { setLoading(false); }
  }

  async function downloadEncryptedBackup() {
    setBackupNotice("");
    if (backupPassphrase.length < 12) {
      setBackupNotice("Use at least 12 characters. A memorable multi-word passphrase is excellent.");
      return;
    }
    if (backupPassphrase !== backupConfirmation) {
      setBackupNotice("The two passphrases do not match yet.");
      return;
    }

    setBackupBusy(true);
    try {
      const response = await fetch("/api/backstage-retired-slug/backup", { cache: "no-store" });
      const data = await response.json() as BackupResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not prepare the backup.");
      const envelope = await encryptBackupSnapshot(data.backup, backupPassphrase);
      const blob = new Blob([JSON.stringify(envelope)], { type: "application/vnd.hackmusic.backup+json" });
      const link = document.createElement("a");
      const stamp = data.backup.exportedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
      const downloadUrl = URL.createObjectURL(blob);
      link.href = downloadUrl;
      link.download = `hackmusic-backup-${stamp}.hackmusic-backup`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      const rows = Object.values(data.backup.counts).reduce((sum, count) => sum + count, 0);
      setBackupNotice(`✅ Encrypted ${number(rows)} database rows. Store the file and passphrase separately.`);
      setBackupPassphrase("");
      setBackupConfirmation("");
    } catch (error) {
      setBackupNotice(error instanceof Error ? error.message : "Could not create the encrypted backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  return <main className="hosted-admin-shell">
    <header className="admin-topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Admin</span></a><div className="admin-identity"><span>🔐 {ownerEmail}</span><a href={signOutPath}>Sign out</a></div></header>
    <section className="admin-hero"><div><p className="eyebrow">🪩 DATABASE BACKSTAGE</p><h1>Party<br />evidence.</h1></div><div className="admin-hero-note"><strong>Owner only. Read only.</strong><span>Room inspection hides host keys. Boo identities remain anonymous. Chaos, but with boundaries.</span></div></section>
    {message && <p className="admin-message" role="alert">{message}</p>}
    {!selected ? <>
      <section className="admin-toolbar"><label htmlFor="admin-search">FIND A ROOM</label><input id="admin-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Room code or event name" /><button type="button" disabled={loading} onClick={() => void loadOverview()}>{loading ? "Refreshing…" : "↻ Refresh data"}</button><span>{overview ? `Updated ${date(overview.generatedAt)}` : "Connecting…"}</span></section>
      {overview && <section className="admin-metrics" aria-label="Database totals">{[["Rooms", overview.totals.rooms], ["Live now", overview.totals.liveRooms], ["Humans", overview.totals.participants], ["Tracks", overview.totals.tracks], ["Reactions", overview.totals.reactions]].map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</section>}
      {overview && <section className="admin-analytics admin-party-pulse" aria-labelledby="party-pulse-heading">
        <div className="admin-analytics-heading"><div><p className="eyebrow">LIVE DATABASE · LAST {overview.partyPulse.periodDays} DAYS</p><h2 id="party-pulse-heading">🎛️ Site pulse</h2></div><p>What the parties actually did, grouped by UTC day from {shortDay(overview.partyPulse.startDate)} through {shortDay(overview.partyPulse.endDate)}. Counts are aggregate; participant names and room secrets stay out of this view.</p></div>
        <section className="admin-metrics admin-pulse-metrics" aria-label={`HackMusic activity in the last ${overview.partyPulse.periodDays} days`}>
          <article><strong>{number(overview.partyPulse.totals.activeRooms)}</strong><span>Active rooms</span><small>Unique rooms with any activity</small></article>
          <article><strong>{number(overview.partyPulse.totals.rooms)}</strong><span>Rooms opened</span><small>Created in this window</small></article>
          <article><strong>{number(overview.partyPulse.totals.humans)}</strong><span>Humans joined</span><small>Hosts included</small></article>
          <article><strong>{number(overview.partyPulse.totals.tracks)}</strong><span>Tracks added</span><small>{number(overview.partyPulse.totals.humans ? overview.partyPulse.totals.tracks / overview.partyPulse.totals.humans : 0, 1)} per human</small></article>
          <article><strong>{number(overview.partyPulse.totals.songStarts)}</strong><span>Songs started</span><small>Playback start events</small></article>
          <article><strong>{number(overview.partyPulse.totals.reactions)}</strong><span>Reactions</span><small>{number(overview.partyPulse.totals.songStarts ? overview.partyPulse.totals.reactions / overview.partyPulse.totals.songStarts : 0, 1)} per song start</small></article>
          <article><strong>{number(overview.partyPulse.totals.cheers)}</strong><span>Cheers</span><small>Public appreciation</small></article>
          <article><strong>{number(overview.partyPulse.totals.boos)}</strong><span>Boos</span><small>Still anonymous, obviously</small></article>
        </section>
        <PartyPulseTrend rows={overview.partyPulse.trend} />
        <section className="admin-panel admin-pulse-table">
          <div className="admin-panel-title"><h3>📅 Day by day</h3><span>Newest first · {overview.partyPulse.timezone}</span></div>
          <DataTable columns={[
            { key: "day", label: "Day", format: (value) => shortDay(String(value)) },
            { key: "activeRooms", label: "Active rooms" },
            { key: "rooms", label: "New rooms" },
            { key: "humans", label: "Humans" },
            { key: "tracks", label: "Tracks" },
            { key: "songStarts", label: "Song starts" },
            { key: "reactions", label: "Reactions" },
            { key: "cheers", label: "Cheers" },
            { key: "boos", label: "Boos" },
          ]} rows={[...overview.partyPulse.trend].reverse()} />
          <p className="admin-metric-notes"><strong>Definitions:</strong> active room = a room created or touched by a join, track, reaction, or playback event that day · humans = participant rows, including hosts · reactions = cheers + boos · song starts = recorded playback starts.</p>
        </section>
      </section>}
      {overview && <section className="admin-analytics" aria-labelledby="traffic-heading">
        <div className="admin-analytics-heading"><div><p className="eyebrow">FIRST-PARTY · COOKIE-FREE</p><h2 id="traffic-heading">👀 Website traffic</h2></div><p>Normalized, aggregate analytics. No raw IPs, room codes, query strings, or persistent visitor profiles.</p></div>
        <section className="admin-metrics admin-analytics-metrics" aria-label={`Website traffic in the last ${overview.analytics.periodDays} days`}>
          <article><strong>{number(overview.analytics.pageViews)}</strong><span>Page views · 30d</span><small>{comparison(overview.analytics.pageViews, overview.analytics.previousPageViews)}</small></article>
          <article><strong>{number(overview.analytics.visits)}</strong><span>Visits · 30d</span><small>{comparison(overview.analytics.visits, overview.analytics.previousVisits)}</small></article>
          <article><strong>{number(overview.analytics.visits ? overview.analytics.pageViews / overview.analytics.visits : 0, 1)}</strong><span>Views per visit</span><small>Daily-rotating visit counts</small></article>
          <article><strong>{number(overview.analytics.retainedPageViews)}</strong><span>Retained records</span><small>{overview.analytics.retentionDays}-day maximum</small></article>
        </section>
        <div className="admin-analytics-grid">
          <TrafficTrend rows={overview.analytics.trend} />
          <AnalyticsBreakdown title="🗺️ Top pages" note="Last 30 days" rows={overview.analytics.topPages} />
          <AnalyticsBreakdown title="↗️ Referrers" note="Hostnames only" rows={overview.analytics.referrers} />
          <AnalyticsBreakdown title="📱 Devices" note="Broad classes" rows={overview.analytics.devices} />
          <AnalyticsBreakdown title="🌎 Countries" note="Provider code" rows={overview.analytics.countries} />
        </div>
      </section>}
      <section className="admin-panel admin-backup" aria-labelledby="admin-backup-heading">
        <div className="admin-panel-title"><h2 id="admin-backup-heading">🧳 Disaster recovery</h2><span>Manual · owner only</span></div>
        <div className="admin-backup-grid">
          <div className="admin-backup-copy">
            <p className="eyebrow">COMPLETE ENCRYPTED EXPORT</p>
            <h3>Take the database with you.</h3>
            <p>Downloads every room, human, track, reaction, party-history event, and privacy-preserving analytics row. Temporary anti-spam counters stay behind because they are not product data.</p>
            <ul>
              <li>🔐 AES-256-GCM encryption happens only in this browser.</li>
              <li>🧠 Your passphrase is never sent to HackMusic or stored anywhere.</li>
              <li>⚠️ No “forgot password” button exists. Keep it somewhere sensible.</li>
            </ul>
          </div>
          <form className="admin-backup-form" onSubmit={(event) => { event.preventDefault(); void downloadEncryptedBackup(); }}>
            <label htmlFor="backup-passphrase">BACKUP PASSPHRASE</label>
            <input id="backup-passphrase" type="password" minLength={12} autoComplete="new-password" value={backupPassphrase} onChange={(event) => setBackupPassphrase(event.target.value)} placeholder="12+ characters; longer is calmer" />
            <label htmlFor="backup-confirmation">TYPE IT AGAIN</label>
            <input id="backup-confirmation" type="password" minLength={12} autoComplete="new-password" value={backupConfirmation} onChange={(event) => setBackupConfirmation(event.target.value)} placeholder="Confirm the secret phrase" />
            <button type="submit" disabled={backupBusy}>{backupBusy ? "Encrypting the evidence…" : "🔒 Download encrypted backup"}</button>
            {backupNotice && <p className="admin-backup-notice" role="status">{backupNotice}</p>}
          </form>
        </div>
      </section>
      <section className="admin-panel"><div className="admin-panel-title"><h2>🎉 Rooms</h2><span>Newest 100</span></div><div className="admin-room-list">{rooms.map((room) => <button type="button" onClick={() => void openRoom(room.code)} key={room.code}><strong className="admin-room-code">{room.code}</strong><span><b>{room.title}</b><small>{date(room.createdAt)} · {room.queueMode}</small><small>{room.participants} humans · {room.tracks} tracks · {room.reactions} reactions</small></span><i className={`admin-room-status ${room.status}`}>{room.status}</i></button>)}{!loading && !rooms.length && <p className="admin-empty">{search ? "No matching rooms." : "No parties have left evidence yet."}</p>}</div></section>
    </> : <section className="admin-detail"><button className="admin-back" type="button" onClick={() => setSelected(null)}>← All rooms</button><div className="admin-detail-heading"><div><p className="eyebrow">ROOM {selected.room.code}</p><h2>{selected.room.title}</h2><p>{selected.room.status.toUpperCase()} · {selected.room.queueMode} queue{selected.room.scheduledFor ? ` · expected ${date(selected.room.scheduledFor)}` : ""} · created {date(selected.room.createdAt)}</p></div></div><div className="admin-detail-grid">
      <section className="admin-panel"><div className="admin-panel-title"><h3>👥 Participants</h3><span>{selected.participants.length} rows</span></div><DataTable columns={[{ key: "name", label: "Name" }, { key: "score", label: "Score" }, { key: "joinedAt", label: "Joined", format: (value) => date(String(value)) }]} rows={selected.participants} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>🎵 Tracks</h3><span>{selected.submissions.length} rows</span></div><DataTable columns={[{ key: "title", label: "Track" }, { key: "artist", label: "Artist" }, { key: "submittedBy", label: "Added by" }, { key: "status", label: "Status" }, { key: "skipReason", label: "Skip reason", format: (value) => value ? String(value) : "—" }, { key: "skipPercent", label: "Skipped at", format: (value) => typeof value === "number" ? `${value}%` : "—" }, { key: "submittedAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.submissions} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>⚡ Reactions</h3><span>{selected.reactions.length} rows</span></div><DataTable columns={[{ key: "kind", label: "Reaction", format: (value) => value === "up" ? "🙌 Cheer" : "👻 Boo" }, { key: "actor", label: "Person" }, { key: "track", label: "Track" }, { key: "createdAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.reactions} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>🔊 Activity</h3><span>{selected.activity.length} rows</span></div><DataTable columns={[{ key: "kind", label: "Event" }, { key: "actor", label: "Person" }, { key: "track", label: "Track" }, { key: "createdAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.activity} /></section>
    </div></section>}
  </main>;
}
