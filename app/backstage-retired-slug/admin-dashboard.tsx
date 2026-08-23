"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AdminOverview = {
  generatedAt: string;
  totals: { rooms: number; liveRooms: number; participants: number; tracks: number; reactions: number };
  rooms: Array<{ code: string; title: string; status: string; queueMode: string; createdAt: string; currentTrack: string | null; participants: number; tracks: number; reactions: number }>;
};

type AdminRoom = {
  room: { code: string; title: string; status: string; queueMode: string; scheduledFor: string | null; createdAt: string };
  participants: Array<{ name: string; score: number; joinedAt: string }>;
  submissions: Array<{ title: string; artist: string; duration: string; status: string; submittedBy: string; submittedAt: string }>;
  reactions: Array<{ kind: string; actor: string; track: string; createdAt: string }>;
  activity: Array<{ kind: string; actor: string | null; track: string | null; createdAt: string }>;
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

export default function AdminDashboard({ ownerEmail, signOutPath }: { ownerEmail: string; signOutPath: string }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [selected, setSelected] = useState<AdminRoom | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

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

  return <main className="hosted-admin-shell">
    <header className="admin-topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic Admin</span></a><div className="admin-identity"><span>🔐 {ownerEmail}</span><a href={signOutPath}>Sign out</a></div></header>
    <section className="admin-hero"><div><p className="eyebrow">🪩 DATABASE BACKSTAGE</p><h1>Party<br />evidence.</h1></div><div className="admin-hero-note"><strong>Owner only. Read only.</strong><span>No host keys. Boo identities remain anonymous. Chaos, but with boundaries.</span></div></section>
    {message && <p className="admin-message" role="alert">{message}</p>}
    {!selected ? <>
      <section className="admin-toolbar"><label htmlFor="admin-search">FIND A ROOM</label><input id="admin-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Room code or event name" /><button type="button" disabled={loading} onClick={() => void loadOverview()}>{loading ? "Refreshing…" : "↻ Refresh data"}</button><span>{overview ? `Updated ${date(overview.generatedAt)}` : "Connecting…"}</span></section>
      {overview && <section className="admin-metrics" aria-label="Database totals">{[["Rooms", overview.totals.rooms], ["Live now", overview.totals.liveRooms], ["Humans", overview.totals.participants], ["Tracks", overview.totals.tracks], ["Reactions", overview.totals.reactions]].map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</section>}
      <section className="admin-panel"><div className="admin-panel-title"><h2>🎉 Rooms</h2><span>Newest 100</span></div><div className="admin-room-list">{rooms.map((room) => <button type="button" onClick={() => void openRoom(room.code)} key={room.code}><strong className="admin-room-code">{room.code}</strong><span><b>{room.title}</b><small>{date(room.createdAt)} · {room.queueMode}</small><small>{room.participants} humans · {room.tracks} tracks · {room.reactions} reactions</small></span><i className={`admin-room-status ${room.status}`}>{room.status}</i></button>)}{!loading && !rooms.length && <p className="admin-empty">{search ? "No matching rooms." : "No parties have left evidence yet."}</p>}</div></section>
    </> : <section className="admin-detail"><button className="admin-back" type="button" onClick={() => setSelected(null)}>← All rooms</button><div className="admin-detail-heading"><div><p className="eyebrow">ROOM {selected.room.code}</p><h2>{selected.room.title}</h2><p>{selected.room.status.toUpperCase()} · {selected.room.queueMode} queue{selected.room.scheduledFor ? ` · expected ${date(selected.room.scheduledFor)}` : ""} · created {date(selected.room.createdAt)}</p></div></div><div className="admin-detail-grid">
      <section className="admin-panel"><div className="admin-panel-title"><h3>👥 Participants</h3><span>{selected.participants.length} rows</span></div><DataTable columns={[{ key: "name", label: "Name" }, { key: "score", label: "Score" }, { key: "joinedAt", label: "Joined", format: (value) => date(String(value)) }]} rows={selected.participants} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>🎵 Tracks</h3><span>{selected.submissions.length} rows</span></div><DataTable columns={[{ key: "title", label: "Track" }, { key: "artist", label: "Artist" }, { key: "submittedBy", label: "Added by" }, { key: "status", label: "Status" }, { key: "submittedAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.submissions} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>⚡ Reactions</h3><span>{selected.reactions.length} rows</span></div><DataTable columns={[{ key: "kind", label: "Reaction", format: (value) => value === "up" ? "🙌 Cheer" : "👻 Boo" }, { key: "actor", label: "Person" }, { key: "track", label: "Track" }, { key: "createdAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.reactions} /></section>
      <section className="admin-panel"><div className="admin-panel-title"><h3>🔊 Activity</h3><span>{selected.activity.length} rows</span></div><DataTable columns={[{ key: "kind", label: "Event" }, { key: "actor", label: "Person" }, { key: "track", label: "Track" }, { key: "createdAt", label: "When", format: (value) => date(String(value)) }]} rows={selected.activity} /></section>
    </div></section>}
  </main>;
}
