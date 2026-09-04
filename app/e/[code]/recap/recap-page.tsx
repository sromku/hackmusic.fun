"use client";

import { useEffect, useState } from "react";
import { isDevelopmentHost } from "../../../../lib/dev-only";
import type { PartyRecapPage, RecapPlayer, RecapRelation, RecapSongMention } from "../../../../lib/party-contract";
import { trackSourceLabel } from "../../../../lib/party-format";
import { hostStorageKey, participantStorageKey, personaFromSearch } from "../../../../lib/party-storage";
import { shareHallOfFame } from "../../../../lib/recap-card";

function Relation({ label, emoji, relation, empty }: { label: string; emoji: string; relation: RecapRelation | null; empty: string }) {
  return <div className={`receipt-line ${relation ? "" : "quiet"}`}><span className="receipt-emoji" aria-hidden="true">{emoji}</span><div><small>{label}</small>{relation ? <strong><span className={`avatar ${relation.color}`}>{relation.avatar}</span> {relation.name} <b>×{relation.count}</b></strong> : <strong>{empty}</strong>}</div></div>;
}

function clockTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function minutesLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function roomPersonality(cheerShare: number | null, boos: number, cheers: number) {
  if (cheerShare === null) return { title: "Silent room", copy: "Nobody reacted to anything. Either the speaker was broken or everyone was very polite." };
  if (cheerShare >= 80) return { title: "Cheer-heavy room", copy: `${cheerShare}% cheers. Suspiciously supportive. Did anyone actually listen?` };
  if (cheerShare >= 60) return { title: "Generous room", copy: `${cheerShare}% cheers, with just enough boos to keep the DJ honest.` };
  if (cheerShare >= 40) return { title: "Balanced room", copy: `${cheers} cheers, ${boos} boos. Democracy at its most exhausting.` };
  if (cheerShare >= 20) return { title: "Boo-heavy room", copy: `${100 - cheerShare}% boos. Everyone came to fight.` };
  return { title: "Hostile environment", copy: `${100 - cheerShare}% boos. The playlist filed a complaint.` };
}

function SongTag({ song }: { song: RecapSongMention }) {
  return <span className="song-tag"><b dir="auto">{song.title}</b> <span className={`avatar ${song.pickerColor}`}>{song.pickerAvatar}</span> {song.pickerName}</span>;
}

type PreviousParty = { code: string; title: string; topName: string; topScore: number; cheers: number; boos: number; songs: number };

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
  const [previousParties, setPreviousParties] = useState<PreviousParty[]>([]);

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

    // Earlier parties this browser hosted or attended: a light comparison, best effort only.
    let hosted: Array<{ code: string; title: string; status: string }> = [];
    try {
      const stored = JSON.parse(window.localStorage.getItem("hackmusic:hostedRooms") ?? "[]") as unknown;
      if (Array.isArray(stored)) hosted = stored.filter((room): room is { code: string; title: string; status: string } => Boolean(room && typeof room === "object" && "code" in room));
    } catch { /* no history */ }
    const candidates = hosted.filter((room) => room.code !== code && room.status === "ended").slice(0, 5);
    Promise.all(candidates.map(async (room) => {
      const id = window.localStorage.getItem(participantStorageKey(room.code, persona)) ?? "";
      if (!id) return null;
      try {
        const response = await fetch(`/api/party?code=${encodeURIComponent(room.code)}&recap=1`, { headers: { "x-hackmusic-participant": id }, cache: "no-store" });
        const data = await response.json() as { recap?: PartyRecapPage };
        if (!response.ok || !data.recap) return null;
        const top = data.recap.players[0];
        return { code: room.code, title: data.recap.title, topName: top ? (top.name === "You" ? top.displayName : top.name) : "—", topScore: top?.score ?? 0, cheers: data.recap.stats.cheers, boos: data.recap.stats.boos, songs: data.recap.stats.songsPlayed };
      } catch { return null; }
    })).then((results) => setPreviousParties(results.filter((entry): entry is PreviousParty => Boolean(entry)))).catch(() => undefined);
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
  const insights = recap.insights;
  const personality = roomPersonality(insights.cheerShare, recap.stats.boos, recap.stats.cheers);
  const arcMax = Math.max(1, ...recap.songs.map((song) => Math.max(song.cheers, song.boos)));
  const guessBoard = [...recap.players].filter((player) => player.guessesMade > 0).sort((left, right) => right.guessesCorrect - left.guessesCorrect || left.guessesMade - right.guessesMade);

  return <main className="hall-shell">
    <div className="shape shape-one" aria-hidden="true" /><div className="shape shape-two" aria-hidden="true" /><div className="shape shape-three" aria-hidden="true" />
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">HM</span><span>HackMusic</span></a><div className="room-pill"><span className="live-dot ended" /> 🏛️ HALL OF FAME · ROOM {recap.code}</div></header>

    <section className="hall-hero">
      <div><p className="eyebrow">🏛️ PERMANENT RECORD · {recap.musicSource === "youtube" ? "YOUTUBE ROOM" : "SPOTIFY ROOM"}{recap.theme && <> · 🎯 {recap.theme}</>}</p><h1>{recap.title}</h1><p className="hall-lede">Every score, every trophy, every boo with a name on it. Nothing here can be appealed.</p><p className="hall-personality"><b>🧠 {personality.title}.</b> {personality.copy}</p></div>
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
        <div className="receipt-mini"><span>🎯 {player.consistency.picks ? `${player.consistency.wins} for ${player.consistency.picks}` : "no judged picks"}</span><span>🕵️ {player.guessesMade ? `${player.guessesCorrect}/${player.guessesMade} guesses` : "no guesses"}</span><span>💸 {player.pointsGiven >= 0 ? `+${player.pointsGiven}` : player.pointsGiven} pts given</span></div>
        <Relation label="BIGGEST FAN" emoji="💖" relation={player.biggestFan} empty="No fans. Yet." />
        <Relation label="HARSHEST CRITIC" emoji="🔪" relation={player.harshestCritic} empty="Nobody booed them. Unbelievable." />
        <Relation label="CHEERED MOST" emoji="🙌" relation={player.favoriteTarget} empty="Cheered nobody. Hard to impress." />
        <Relation label="BOOED MOST" emoji="👻" relation={player.nemesis} empty="Booed nobody. Saint, or asleep." />
      </article>)}</div>
    </section>

    <section className="hall-card hall-arc" aria-labelledby="arc-title">
      <div className="card-title-row"><h2 id="arc-title">📈 THE PARTY ARC</h2><span>🙌 UP · 👻 DOWN</span></div>
      {recap.songs.length ? <div className="arc-chart" role="img" aria-label={`Cheers and boos per song in play order: ${recap.songs.map((song) => `${song.title} ${song.cheers} cheers ${song.boos} boos`).join("; ")}`}>{recap.songs.map((song) => <div className={`arc-column ${song.skipReason === "boos" ? "boos" : ""}`} key={song.queueId} title={`${song.order}. ${song.title} · 🙌 ${song.cheers} · 👻 ${song.boos}`}><div className="arc-up"><span style={{ height: `${(song.cheers / arcMax) * 100}%` }} /></div><div className="arc-down"><span style={{ height: `${(song.boos / arcMax) * 100}%` }} /></div><small>{song.order}</small></div>)}</div> : <p className="hall-empty">No arc. No songs. A flat line.</p>}
      <div className="hall-insight-grid">
        <article className="insight"><small>⏱️ PARTY LENGTH</small><strong>{insights.minutes ? `${Math.floor(insights.minutes / 60) ? `${Math.floor(insights.minutes / 60)}h ` : ""}${insights.minutes % 60}m` : "—"}</strong><p>{insights.startedAt ? `${clockTime(insights.startedAt)} → ${clockTime(insights.endedAt)}` : "No songs, no clock."}</p></article>
        <article className="insight"><small>🥁 REACTION PACE</small><strong>{insights.reactionPaceSeconds ? `every ${insights.reactionPaceSeconds}s` : "—"}</strong><p>{insights.reactionPaceSeconds ? "One opinion, on average, that often." : "Not enough reactions to time."}</p></article>
        <article className="insight"><small>🔥 PEAK HALF HOUR</small><strong>{insights.peakWindow ? clockTime(insights.peakWindow.start) : "—"}</strong><p>{insights.peakWindow ? `${insights.peakWindow.reactions} reactions in 30 minutes. Everything after was survival.` : "The room never peaked. Bold."}</p></article>
        <article className="insight coral"><small>🚨 FASTEST BOO</small><strong>{insights.fastestBoo ? `${insights.fastestBoo.seconds}s in` : "—"}</strong><p>{insights.fastestBoo ? <><SongTag song={insights.fastestBoo.song} /> · by <span className={`avatar ${insights.fastestBoo.by.color}`}>{insights.fastestBoo.by.avatar}</span> {insights.fastestBoo.by.name}</> : "Nobody pre-judged a song. Growth."}</p></article>
      </div>
    </section>

    <section className="hall-card" aria-labelledby="songs-title">
      <div className="card-title-row"><h2 id="songs-title">🎼 SONG INTELLIGENCE</h2><span>📼 {recap.songs.length} ANALYSED</span></div>
      <div className="hall-insight-grid">
        <article className="insight mint"><small>🛡️ SURVIVOR OF THE NIGHT</small><strong>{insights.survivor ? `${insights.survivor.boos} boo${insights.survivor.boos === 1 ? "" : "s"}, still finished` : "—"}</strong><p>{insights.survivor ? <SongTag song={insights.survivor.song} /> : "No song took a hit and lived."}</p></article>
        <article className="insight"><small>🏃 LONGEST LIFE</small><strong>{insights.longestLife ? minutesLabel(insights.longestLife.seconds) : "—"}</strong><p>{insights.longestLife ? <SongTag song={insights.longestLife.song} /> : "Durations unknown."}</p></article>
        <article className="insight coral"><small>🪦 SHORTEST LIFE</small><strong>{insights.shortestLife ? `${minutesLabel(insights.shortestLife.seconds)} · ${insights.shortestLife.percent}%` : "—"}</strong><p>{insights.shortestLife ? <SongTag song={insights.shortestLife.song} /> : "Nothing was booed off with a stopwatch running."}</p></article>
        <article className="insight sun"><small>🎤 ARTIST OF THE ROOM</small><strong dir="auto">{insights.topArtist ? insights.topArtist.artist : "—"}</strong><p>{insights.topArtist ? `${insights.topArtist.songs} song${insights.topArtist.songs === 1 ? "" : "s"}${insights.topArtist.booedOff ? `, ${insights.topArtist.booedOff} booed off` : ", none booed off"}.` : "No artists on record."}</p></article>
        <article className="insight"><small>🍳 DEEP CUTS</small><strong>{insights.silentSongs}</strong><p>{insights.silentSongs === 1 ? "song got zero reactions. The room was in the kitchen." : "songs got zero reactions. The room was in the kitchen."}</p></article>
        <article className="insight"><small>🏟️ ANTHEMS</small><strong>{insights.unanimousSongs}</strong><p>{insights.unanimousSongs === 1 ? "song made everyone react. A moment." : "songs made everyone react. Moments."}</p></article>
      </div>
    </section>

    <section className="hall-card" aria-labelledby="people-title">
      <div className="card-title-row"><h2 id="people-title">🧬 PEOPLE INTELLIGENCE</h2><span>🔬 {recap.players.length} SPECIMENS</span></div>
      <div className="hall-insight-grid">
        <article className="insight mint"><small>🧿 VIBE SOULMATES</small><strong>{insights.soulmates ? <><span className={`avatar ${insights.soulmates.left.color}`}>{insights.soulmates.left.avatar}</span> {insights.soulmates.left.name} & <span className={`avatar ${insights.soulmates.right.color}`}>{insights.soulmates.right.avatar}</span> {insights.soulmates.right.name}</> : "—"}</strong><p>{insights.soulmates ? `Agreed on ${insights.soulmates.count} song${insights.soulmates.count === 1 ? "" : "s"}. Share a playlist already.` : "Nobody agreed on anything. Healthy."}</p></article>
        <article className="insight coral"><small>🙃 CONTRARIAN</small><strong>{insights.contrarian ? <><span className={`avatar ${insights.contrarian.color}`}>{insights.contrarian.avatar}</span> {insights.contrarian.name}</> : "—"}</strong><p>{insights.contrarian ? `Voted against the room ${insights.contrarian.count} times. On purpose, probably.` : "Everyone went with the crowd. Sheep, but happy sheep."}</p></article>
        <article className="insight"><small>👻 GHOSTS</small><strong>{insights.ghosts.length ? insights.ghosts.map((ghost) => <span key={ghost.id}><span className={`avatar ${ghost.color}`}>{ghost.avatar}</span> {ghost.name} </span>) : "None"}</strong><p>{insights.ghosts.length ? "Joined, submitted nothing, reacted to nothing. Present in spirit." : "Everyone did something. Remarkable turnout."}</p></article>
        <article className="insight sun"><small>💸 BOO ECONOMY</small><strong>{insights.villain ? <><span className={`avatar ${insights.villain.color}`}>{insights.villain.avatar}</span> {insights.villain.name} · {insights.villain.count} pts</> : "—"}</strong><p>{insights.villain ? `Handed out ${insights.villain.count} points net. The reason the scoreboard exists.` : "Nobody ran a deficit. Wholesome."}{insights.saint && <> Most generous: <span className={`avatar ${insights.saint.color}`}>{insights.saint.avatar}</span> {insights.saint.name} (+{insights.saint.count}).</>}</p></article>
        <article className="insight"><small>🕵️ HARDEST TO GUESS</small><strong>{insights.hardestToGuess ? <><span className={`avatar ${insights.hardestToGuess.player.color}`}>{insights.hardestToGuess.player.avatar}</span> {insights.hardestToGuess.player.name}</> : "—"}</strong><p>{insights.hardestToGuess ? `${insights.hardestToGuess.correct} of ${insights.hardestToGuess.guesses} guesses landed. A musical enigma.` : "Not enough guessing to crown an enigma."}</p></article>
        <article className="insight"><small>🔎 DETECTIVE LEADERBOARD</small><strong>{insights.bestDetective ? <><span className={`avatar ${insights.bestDetective.color}`}>{insights.bestDetective.avatar}</span> {insights.bestDetective.name} · {insights.bestDetective.count} right</> : "—"}</strong><p>{guessBoard.length ? guessBoard.slice(0, 4).map((player) => `${player.avatar} ${player.name === "You" ? player.displayName : player.name} ${player.guessesCorrect}/${player.guessesMade}`).join(" · ") : "Nobody guessed. Nobody cared who picked what."}</p></article>
      </div>
    </section>

    {(insights.shields.length > 0 || insights.boosts.length > 0 || insights.clutch.length > 0) && <section className="hall-card" aria-labelledby="drama-title">
      <div className="card-title-row"><h2 id="drama-title">🎭 DRAMA REPORT</h2><span>🛡️ ⚡ 😬</span></div>
      <div className="hall-insight-grid">
        {insights.shields.map((entry) => <article className={`insight ${entry.outcome === "saved" ? "mint" : entry.outcome === "wasted" ? "coral" : ""}`} key={`shield-${entry.song.queueId}`}><small>🛡️ SHIELD {entry.outcome === "saved" ? "SAVED A SONG" : entry.outcome === "wasted" ? "WASTED" : "HELD THE LINE"}</small><strong><SongTag song={entry.song} /></strong><p>{entry.outcome === "saved" ? `Took ${entry.boos} boos and finished anyway. Money well spent.` : entry.outcome === "wasted" ? "Nobody booed it. Peak paranoia." : `Absorbed a boo out of ${entry.boos}. Still went down, but with dignity.`}</p></article>)}
        {insights.boosts.map((entry, index) => <article className={`insight ${entry.survived ? "sun" : "coral"}`} key={`boost-${index}`}><small>⚡ DOUBLE CHEER</small><strong><span className={`avatar ${entry.by.color}`}>{entry.by.avatar}</span> {entry.by.name} → <SongTag song={entry.song} /></strong><p>{entry.survived ? "+6 points, and the song survived. Investment of the night." : "+6 points on a song the room later murdered. Bold portfolio."}</p></article>)}
        {insights.clutch.map((song) => <article className="insight" key={`clutch-${song.queueId}`}><small>😬 CLUTCH MOMENT</small><strong><SongTag song={song} /></strong><p>One boo from the plug. Lived to see the outro.</p></article>)}
      </div>
    </section>}

    {previousParties.length > 0 && <section className="hall-card" aria-labelledby="history-title">
      <div className="card-title-row"><h2 id="history-title">📚 YOUR PREVIOUS PARTIES</h2><span>🗝️ THIS BROWSER</span></div>
      <table className="hall-history"><thead><tr><th>Party</th><th>Top scorer</th><th>Songs</th><th>🙌</th><th>👻</th></tr></thead><tbody><tr className="current"><td dir="auto">{recap.title} <small>(this one)</small></td><td>{recap.players[0] ? `${recap.players[0].avatar} ${recap.players[0].displayName} · ${recap.players[0].score}` : "—"}</td><td>{recap.stats.songsPlayed}</td><td>{recap.stats.cheers}</td><td>{recap.stats.boos}</td></tr>{previousParties.map((party) => <tr key={party.code}><td dir="auto"><a href={`/e/${party.code}/recap`}>{party.title}</a></td><td>{party.topName} · {party.topScore}</td><td>{party.songs}</td><td>{party.cheers}</td><td>{party.boos}</td></tr>)}</tbody></table>
      <p className="hall-empty">{recap.stats.boos > Math.max(0, ...previousParties.map((party) => party.boos)) ? "🏆 Most boos of any party this browser has seen. A new low, proudly." : recap.stats.cheers > Math.max(0, ...previousParties.map((party) => party.cheers)) ? "🏆 Most cheers of any party this browser has seen. Growth." : "Previous parties were louder. Try harder next time."}</p>
    </section>}

    <section className="hall-card" aria-labelledby="playlist-title">
      <div className="card-title-row"><h2 id="playlist-title">📼 THE PLAYLIST</h2><span>{recap.songs.length} {recap.songs.length === 1 ? "SONG" : "SONGS"}</span></div>
      {recap.songs.length ? <ol className="hall-playlist">{recap.songs.map((song) => <li key={song.queueId} className={song.status === "played" ? "played" : song.skipReason === "boos" ? "boos" : "host"}><span className="playlist-order">{String(song.order).padStart(2, "0")}</span><div className="playlist-copy"><strong dir="auto">{song.title}</strong><span dir="auto">🎤 {song.artist}{song.duration ? ` · ${song.duration}` : ""} · {trackSourceLabel(song.id)}</span><small><span className={`avatar ${song.pickerColor}`}>{song.pickerAvatar}</span> {song.pickerName} · 🙌 {song.cheers} · 👻 {song.boos}</small></div><b className={`song-outcome ${song.status === "played" ? "played" : song.skipReason === "boos" ? "boos" : "host"}`}>{song.status === "played" ? "✅ PLAYED" : song.skipReason === "boos" ? `🪦 BOOED OFF${song.skipPercent === null ? "" : ` AT ${song.skipPercent}%`}` : "⏭️ SKIPPED"}</b>{song.webUrl && <a href={song.webUrl} target="_blank" rel="noreferrer" aria-label={`Open ${song.title} on ${trackSourceLabel(song.id)}`}>↗</a>}</li>)}</ol> : <p className="hall-empty">🦗 No songs reached the speaker. A conceptual party.</p>}
    </section>

    <footer className="hall-footer"><span>Made with questionable taste at <a href="/">hackmusic.fun</a></span><button type="button" onClick={() => void share()} disabled={shareBusy}>📸 Save as image</button></footer>
    {notice && <div className="toast" role="status">{notice}</div>}
  </main>;
}
