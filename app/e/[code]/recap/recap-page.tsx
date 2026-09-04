"use client";

import { useEffect, useState } from "react";
import { isDevelopmentHost } from "../../../../lib/dev-only";
import type { PartyRecapPage, RecapPlayer, RecapRelation } from "../../../../lib/party-contract";
import { trackSourceLabel } from "../../../../lib/party-format";
import { hostStorageKey, participantStorageKey, personaFromSearch } from "../../../../lib/party-storage";
import { shareHallOfFame } from "../../../../lib/recap-card";

function Relation({ label, emoji, relation, empty }: { label: string; emoji: string; relation: RecapRelation | null; empty: string }) {
  return <div className={`receipt-line ${relation ? "" : "quiet"}`}><span className="receipt-emoji" aria-hidden="true">{emoji}</span><div><small>{label}</small>{relation ? <strong><span className={`avatar ${relation.color}`}>{relation.avatar}</span> {relation.name} <b>×{relation.count}</b></strong> : <strong>{empty}</strong>}</div></div>;
}

function rankLabel(rank: number) {
  return rank === 1 ? "👑" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
}

function playerVerdict(player: RecapPlayer) {
  if (player.rank === 1) return "Owns the aux cable in spirit.";
  if (player.boosReceived > player.cheersReceived && player.boosReceived > 0) return "Beloved by nobody, remembered by everyone.";
  if (player.cheersGiven === 0 && player.boosGiven === 0) return "Reacted to nothing. Judged everything.";
  if (player.boosGiven > player.cheersGiven) return "Came for the music, stayed for the violence.";
  if (player.songsPicked === 0) return "Voted all night, submitted zero songs. A critic.";
  return "Solid taste. Slightly too polite.";
}

export default function RecapPage({ code }: { code: string }) {
  const [recap, setRecap] = useState<PartyRecapPage | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [hostPagePath, setHostPagePath] = useState("");

  useEffect(() => {
    const persona = isDevelopmentHost(window.location.hostname) ? personaFromSearch(window.location.search) : "";
    const participantId = window.localStorage.getItem(participantStorageKey(code, persona)) ?? "";
    const hostKey = window.localStorage.getItem(hostStorageKey(code, persona)) ?? "";
    const personaQuery = persona ? `?persona=${encodeURIComponent(persona)}` : "";
    queueMicrotask(() => setHostPagePath(hostKey ? `/e/${code}/host${personaQuery}` : ""));
    if (!participantId) {
      queueMicrotask(() => setError("The Hall of Fame is for people who were at the party. Open the room from your invite on the device you used."));
      return;
    }
    fetch(`/api/party?code=${encodeURIComponent(code)}&recap=1`, { headers: { "x-hackmusic-participant": participantId, ...(hostKey ? { "x-hackmusic-host-key": hostKey } : {}) }, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { error?: string; recap?: PartyRecapPage };
        if (!response.ok || !data.recap) throw new Error(data.error ?? "The Hall of Fame could not be loaded.");
        setRecap(data.recap);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "The Hall of Fame could not be loaded."));
  }, [code]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function share() {
    if (!recap || shareBusy) return;
    setShareBusy(true);
    try {
      const delivered = await shareHallOfFame(recap);
      setNotice(delivered === "shared" ? "📸 Hall of Fame shared." : "📸 Hall of Fame image saved to your downloads.");
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setNotice(reason instanceof Error ? reason.message : "The image could not be created.");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setNotice("🔗 Link copied. It works for everyone who was in the room."); }
    catch { setNotice("Copy the address bar link to share this page."); }
  }

  if (error) return <main className="missing-room"><span className="brand-mark">HM</span><p className="eyebrow">🏛️ HALL OF FAME</p><h1>{error}</h1><a href={`/e/${code}`}>Open the room page →</a><a href="/">Create a new room →</a></main>;
  if (!recap) return <main className="loading-room"><span className="brand-mark">HM</span><p>Polishing the trophies for room {code}…</p></main>;

  const podium = recap.players.slice(0, 3);
  const mostBooedSong = [...recap.songs].sort((left, right) => right.boos - left.boos)[0];
  const mostCheeredSong = [...recap.songs].sort((left, right) => right.cheers - left.cheers)[0];
  const detectiveRate = recap.stats.guesses ? Math.round((recap.stats.correctGuesses / recap.stats.guesses) * 100) : 0;

  return <main className="hall-shell">
    <div className="shape shape-one" aria-hidden="true" /><div className="shape shape-two" aria-hidden="true" /><div className="shape shape-three" aria-hidden="true" />
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic</span></a><div className="room-pill"><span className="live-dot ended" /> 🏛️ HALL OF FAME · ROOM {recap.code}</div></header>

    <section className="hall-hero">
      <div><p className="eyebrow">🏛️ PERMANENT RECORD · {recap.musicSource === "youtube" ? "YOUTUBE ROOM" : "SPOTIFY ROOM"}{recap.theme && <> · 🎯 {recap.theme}</>}</p><h1>{recap.title}</h1><p className="hall-lede">Every score, every trophy, every boo with a name on it. Nothing here can be appealed.</p></div>
      <div className="hall-actions"><button type="button" onClick={() => void share()} disabled={shareBusy}>{shareBusy ? "📸 Drawing…" : "📸 Save as image"}</button><button type="button" onClick={() => void copyLink()}>🔗 Copy link</button>{hostPagePath && <a href={hostPagePath}>🎛️ Host page</a>}<a href={`/e/${code}`}>🎉 Room page</a></div>
    </section>

    <section className="hall-stats" aria-label="Party totals">
      <div className="hall-stat sun"><strong>{recap.stats.players}</strong><span>HUMANS</span></div>
      <div className="hall-stat blue"><strong>{recap.stats.songsPlayed}</strong><span>SONGS</span></div>
      <div className="hall-stat mint"><strong>{recap.stats.cheers}</strong><span>CHEERS</span></div>
      <div className="hall-stat coral"><strong>{recap.stats.boos}</strong><span>BOOS</span></div>
      <div className="hall-stat paper"><strong>{recap.stats.songsBooedOff}</strong><span>BOOED OFF</span></div>
      <div className="hall-stat paper"><strong>{recap.stats.guesses ? `${detectiveRate}%` : "—"}</strong><span>DETECTIVE ACCURACY</span></div>
    </section>

    <section className="hall-card hall-podium" aria-labelledby="podium-title">
      <div className="card-title-row"><h2 id="podium-title">🏆 THE PODIUM</h2><span>FINAL · FROZEN</span></div>
      <div className="podium">{[1, 0, 2].map((index) => podium[index]).map((player, column) => player ? <div className={`podium-slot rank-${player.rank}`} key={player.id}><span className={`avatar ${player.color}`}>{player.avatar}</span><strong>{player.name === "You" ? player.displayName : player.name}</strong><b>{player.score} pts</b><small>{rankLabel(player.rank)} {player.name === "You" ? "· that’s you" : ""}</small></div> : <div className="podium-slot empty" key={`empty-${column}`} aria-hidden="true" />)}</div>
      <ol className="hall-scoreboard">{recap.players.map((player) => <li key={player.id} className={player.name === "You" ? "me" : ""}><b>{rankLabel(player.rank)}</b><span className={`avatar ${player.color}`}>{player.avatar}</span><strong>{player.name === "You" ? `${player.displayName} (you)` : player.name}</strong><small>{player.songsPicked} {player.songsPicked === 1 ? "pick" : "picks"} · 🙌 {player.cheersReceived} · 👻 {player.boosReceived}</small><span className="hall-points">{player.score} pts</span></li>)}</ol>
    </section>

    {recap.awards.length > 0 && <section className="hall-card" aria-labelledby="hall-awards-title"><div className="card-title-row"><h2 id="hall-awards-title">🎖️ AWARDS</h2><span>{recap.awards.length} {recap.awards.length === 1 ? "TROPHY" : "TROPHIES"}</span></div><div className="awards-grid">{recap.awards.map((entry) => <article className={`award ${entry.winnerName === "You" ? "mine" : ""}`} key={entry.id}><span className="award-emoji" aria-hidden="true">{entry.emoji}</span><div><strong>{entry.title}</strong><p><span className={`avatar ${entry.winnerColor}`}>{entry.winnerAvatar}</span> <b>{entry.winnerName}</b></p><small>{entry.detail}</small></div></article>)}</div></section>}

    <section className="hall-card hall-receipts" aria-labelledby="receipts-title">
      <div className="card-title-row"><h2 id="receipts-title">🧾 THE RECEIPTS</h2><span>👻 BOOS UNMASKED</span></div>
      <div className="hall-headlines">
        <article className="headline coral"><small>👻 RIVALRY OF THE NIGHT</small>{recap.rivalry ? <strong><span className={`avatar ${recap.rivalry.left.color}`}>{recap.rivalry.left.avatar}</span> {recap.rivalry.left.name} ⚔️ <span className={`avatar ${recap.rivalry.right.color}`}>{recap.rivalry.right.avatar}</span> {recap.rivalry.right.name}</strong> : <strong>No rivalries. Suspiciously polite.</strong>}{recap.rivalry && <p>{recap.rivalry.count} boo{recap.rivalry.count === 1 ? "" : "s"} exchanged. Seating chart updated.</p>}</article>
        <article className="headline mint"><small>🙌 MUTUAL ADMIRATION SOCIETY</small>{recap.bromance ? <strong><span className={`avatar ${recap.bromance.left.color}`}>{recap.bromance.left.avatar}</span> {recap.bromance.left.name} 🤝 <span className={`avatar ${recap.bromance.right.color}`}>{recap.bromance.right.avatar}</span> {recap.bromance.right.name}</strong> : <strong>No fan clubs formed.</strong>}{recap.bromance && <p>{recap.bromance.count} cheer{recap.bromance.count === 1 ? "" : "s"} between them. Get a room. This one is closed.</p>}</article>
        {mostBooedSong && mostBooedSong.boos > 0 && <article className="headline paper"><small>🪦 MOST BOOED SONG</small><strong dir="auto">{mostBooedSong.title}</strong><p>{mostBooedSong.boos} boo{mostBooedSong.boos === 1 ? "" : "s"} · picked by {mostBooedSong.pickerAvatar} {mostBooedSong.pickerName}</p></article>}
        {mostCheeredSong && mostCheeredSong.cheers > 0 && <article className="headline sun"><small>🙌 MOST CHEERED SONG</small><strong dir="auto">{mostCheeredSong.title}</strong><p>{mostCheeredSong.cheers} cheer{mostCheeredSong.cheers === 1 ? "" : "s"} · picked by {mostCheeredSong.pickerAvatar} {mostCheeredSong.pickerName}</p></article>}
      </div>
      <div className="receipt-grid">{recap.players.map((player) => <article className={`receipt ${player.name === "You" ? "me" : ""}`} key={player.id}>
        <header><span className={`avatar ${player.color}`}>{player.avatar}</span><div><strong>{player.name === "You" ? `${player.displayName} (you)` : player.name}</strong><small>{rankLabel(player.rank)} · {player.score} pts · gave 🙌 {player.cheersGiven} 👻 {player.boosGiven}</small></div></header>
        <p className="receipt-verdict">{playerVerdict(player)}</p>
        <Relation label="BIGGEST FAN" emoji="💖" relation={player.biggestFan} empty="No fans. Yet." />
        <Relation label="HARSHEST CRITIC" emoji="🔪" relation={player.harshestCritic} empty="Nobody booed them. Unbelievable." />
        <Relation label="CHEERED MOST" emoji="🙌" relation={player.favoriteTarget} empty="Cheered nobody. Hard to impress." />
        <Relation label="BOOED MOST" emoji="👻" relation={player.nemesis} empty="Booed nobody. Saint, or asleep." />
      </article>)}</div>
    </section>

    <section className="hall-card" aria-labelledby="playlist-title">
      <div className="card-title-row"><h2 id="playlist-title">📼 THE PLAYLIST</h2><span>{recap.songs.length} {recap.songs.length === 1 ? "SONG" : "SONGS"}</span></div>
      {recap.songs.length ? <ol className="hall-playlist">{recap.songs.map((song) => <li key={song.queueId} className={song.status === "played" ? "played" : song.skipReason === "boos" ? "boos" : "host"}><span className="playlist-order">{String(song.order).padStart(2, "0")}</span><div className="playlist-copy"><strong dir="auto">{song.title}</strong><span dir="auto">🎤 {song.artist}{song.duration ? ` · ${song.duration}` : ""} · {trackSourceLabel(song.id)}</span><small><span className={`avatar ${song.pickerColor}`}>{song.pickerAvatar}</span> {song.pickerName} · 🙌 {song.cheers} · 👻 {song.boos}</small></div><b className={`song-outcome ${song.status === "played" ? "played" : song.skipReason === "boos" ? "boos" : "host"}`}>{song.status === "played" ? "✅ PLAYED" : song.skipReason === "boos" ? `🪦 BOOED OFF${song.skipPercent === null ? "" : ` AT ${song.skipPercent}%`}` : "⏭️ SKIPPED"}</b>{song.webUrl && <a href={song.webUrl} target="_blank" rel="noreferrer" aria-label={`Open ${song.title} on ${trackSourceLabel(song.id)}`}>↗</a>}</li>)}</ol> : <p className="hall-empty">🦗 No songs reached the speaker. A conceptual party.</p>}
    </section>

    <footer className="hall-footer"><span>Made with questionable taste at <a href="/">hackmusic.fun</a></span><button type="button" onClick={() => void share()} disabled={shareBusy}>📸 Save as image</button></footer>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}
