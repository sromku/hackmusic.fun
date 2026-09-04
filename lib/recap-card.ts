import type { PartyAward, PartyRecapPage } from "./party-contract";

export type RecapCardData = {
  title: string;
  code: string;
  musicSource: "spotify" | "youtube";
  people: Array<{ name: string; avatar: string; score: number }>;
  awards: PartyAward[];
  songsPlayed: number;
  songsBooedOff: number;
  reactions: number;
};

export const RECAP_CARD_WIDTH = 1080;
export const RECAP_CARD_HEIGHT = 1350;

const INK = "#151515";
const PAPER = "#fffef9";
const COLORS = ["#ffd166", "#ff8fa3", "#8ecae6", "#b5ead7"];

function box(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, shadow = 10) {
  context.fillStyle = INK;
  context.fillRect(x + shadow, y + shadow, width, height);
  context.fillStyle = fill;
  context.fillRect(x, y, width, height);
  context.lineWidth = 5;
  context.strokeStyle = INK;
  context.strokeRect(x, y, width, height);
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, weight = 900, color = INK, maxWidth?: number) {
  context.fillStyle = color;
  context.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.textBaseline = "alphabetic";
  if (maxWidth) context.fillText(value, x, y, maxWidth);
  else context.fillText(value, x, y);
}

/** Draws the shareable end-of-party card. Pure canvas drawing so it can run on any device without a server. */
export function drawRecapCard(canvas: HTMLCanvasElement, data: RecapCardData) {
  canvas.width = RECAP_CARD_WIDTH;
  canvas.height = RECAP_CARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the recap card.");
  context.fillStyle = PAPER;
  context.fillRect(0, 0, RECAP_CARD_WIDTH, RECAP_CARD_HEIGHT);
  // Playful background shapes.
  context.fillStyle = COLORS[0];
  context.beginPath(); context.arc(960, 120, 140, 0, Math.PI * 2); context.fill();
  context.fillStyle = COLORS[2];
  context.fillRect(-60, 1180, 320, 320);
  context.fillStyle = COLORS[1];
  context.beginPath(); context.moveTo(880, 1350); context.lineTo(1080, 1100); context.lineTo(1080, 1350); context.closePath(); context.fill();

  box(context, 60, 60, 120, 120, INK, 0);
  text(context, "HM", 76, 148, 60, 950, PAPER);
  text(context, "HACKMUSIC · FINAL RECAP", 210, 108, 26, 950);
  text(context, `ROOM ${data.code} · ${data.musicSource === "youtube" ? "YOUTUBE ROOM" : "SPOTIFY ROOM"}`, 210, 150, 22, 800, "#5f5a52");
  text(context, data.title, 60, 270, 64, 950, INK, 960);

  const stats = [
    [`${data.songsPlayed}`, "SONGS PLAYED"],
    [`${data.songsBooedOff}`, "BOOED OFF"],
    [`${data.reactions}`, "REACTIONS"],
  ];
  stats.forEach(([value, label], index) => {
    const x = 60 + index * 330;
    box(context, x, 310, 300, 130, COLORS[index % COLORS.length], 8);
    text(context, value, x + 24, 388, 58, 950);
    text(context, label, x + 24, 420, 18, 900, "#3b3733");
  });

  box(context, 60, 490, 960, 400, PAPER, 10);
  text(context, "🏆 FINAL SCOREBOARD", 90, 540, 28, 950);
  data.people.slice(0, 5).forEach((person, index) => {
    const y = 600 + index * 58;
    text(context, index === 0 ? "👑" : `${index + 1}.`, 90, y, 30, 950);
    text(context, `${person.avatar} ${person.name}`, 160, y, 30, 900, INK, 620);
    text(context, `${person.score} pts`, 990 - context.measureText(`${person.score} pts`).width, y, 30, 950);
  });
  if (!data.people.length) text(context, "Nobody scored. A remarkably peaceful party.", 90, 610, 26, 800, "#5f5a52");

  box(context, 60, 940, 960, 340, PAPER, 10);
  text(context, "🎖️ AWARDS", 90, 990, 28, 950);
  const awards = data.awards.slice(0, 4);
  awards.forEach((entry, index) => {
    const y = 1045 + index * 58;
    text(context, `${entry.emoji} ${entry.title}`, 90, y, 26, 950, INK, 380);
    text(context, `${entry.winnerAvatar} ${entry.winnerName}`, 500, y, 26, 850, INK, 480);
  });
  if (!awards.length) text(context, "No awards this time. Try booing harder next party.", 90, 1055, 24, 800, "#5f5a52");
  text(context, "hackmusic.fun", 60, 1315, 22, 900, "#5f5a52");
}

export function recapFileName(code: string) {
  return `hackmusic-${code.toLowerCase()}-recap.png`;
}

export async function recapCardBlob(data: RecapCardData) {
  const canvas = document.createElement("canvas");
  drawRecapCard(canvas, data);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The recap card could not be exported.")), "image/png"));
}

/** Shares through the native sheet when files are supported, otherwise downloads the PNG. Returns how it was delivered. */
export async function shareRecapCard(data: RecapCardData): Promise<"shared" | "downloaded"> {
  const blob = await recapCardBlob(data);
  const file = new File([blob], recapFileName(data.code), { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: `${data.title} · HackMusic recap` });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return "downloaded";
}

/* ---------- Hall of Fame: tall story-style image ---------- */


export const HALL_WIDTH = 1080;
export const HALL_HEIGHT = 1920;

function ellipsize(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

export function drawHallOfFame(canvas: HTMLCanvasElement, recap: PartyRecapPage) {
  canvas.width = HALL_WIDTH;
  canvas.height = HALL_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the Hall of Fame.");
  const insights = recap.insights;
  context.fillStyle = PAPER;
  context.fillRect(0, 0, HALL_WIDTH, HALL_HEIGHT);
  context.fillStyle = COLORS[1];
  context.beginPath(); context.arc(1000, 90, 170, 0, Math.PI * 2); context.fill();
  context.fillStyle = COLORS[2];
  context.fillRect(-80, 1760, 360, 360);
  context.fillStyle = COLORS[0];
  context.beginPath(); context.moveTo(820, 1920); context.lineTo(1080, 1600); context.lineTo(1080, 1920); context.closePath(); context.fill();

  box(context, 60, 60, 120, 120, INK, 0);
  text(context, "HM", 76, 148, 60, 950, PAPER);
  text(context, "HALL OF FAME", 210, 108, 26, 950);
  text(context, `ROOM ${recap.code} · ${recap.musicSource === "youtube" ? "YOUTUBE ROOM" : "SPOTIFY ROOM"}${recap.theme ? ` · 🎯 ${recap.theme.toUpperCase()}` : ""}`, 210, 150, 20, 800, "#5f5a52", 780);
  context.font = "950 60px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
  text(context, ellipsize(context, recap.title, 960), 60, 262, 60, 950);
  const cheerShare = insights.cheerShare;
  const personality = cheerShare === null ? "🧠 Silent room. Nobody reacted to anything." : cheerShare >= 80 ? `🧠 Cheer-heavy room · ${cheerShare}% cheers. Suspiciously supportive.` : cheerShare >= 60 ? `🧠 Generous room · ${cheerShare}% cheers, just enough boos to keep the DJ honest.` : cheerShare >= 40 ? `🧠 Balanced room · ${recap.stats.cheers} cheers, ${recap.stats.boos} boos. Exhausting democracy.` : cheerShare >= 20 ? `🧠 Boo-heavy room · ${100 - cheerShare}% boos. Everyone came to fight.` : `🧠 Hostile environment · ${100 - cheerShare}% boos. The playlist filed a complaint.`;
  context.font = "850 22px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
  text(context, ellipsize(context, personality, 960), 60, 300, 22, 850, "#3b3733");

  const stats = [[`${recap.stats.players}`, "HUMANS"], [`${recap.stats.songsPlayed}`, "SONGS"], [`${recap.stats.cheers}`, "CHEERS"], [`${recap.stats.boos}`, "BOOS"]];
  stats.forEach(([value, label], index) => {
    const x = 60 + index * 245;
    box(context, x, 330, 225, 104, COLORS[index % COLORS.length], 8);
    text(context, value, x + 20, 394, 44, 950);
    text(context, label, x + 20, 420, 15, 900, "#3b3733");
  });

  // Podium
  box(context, 60, 480, 960, 250, PAPER, 10);
  text(context, "🏆 PODIUM", 90, 526, 26, 950);
  const podium = recap.players.slice(0, 3);
  const slots = [{ x: 400, h: 130, label: "1", fill: COLORS[0] }, { x: 130, h: 100, label: "2", fill: COLORS[2] }, { x: 670, h: 80, label: "3", fill: COLORS[3] }];
  podium.forEach((player, index) => {
    const slot = slots[index];
    const top = 706 - slot.h;
    box(context, slot.x, top, 280, slot.h, slot.fill, 6);
    text(context, slot.label, slot.x + 16, top + 42, 32, 950);
    context.font = "900 24px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, `${player.avatar} ${ellipsize(context, player.displayName, 200)}`, slot.x + 58, top + 42, 24, 900);
    text(context, `${player.score} pts`, slot.x + 58, top + 70, 20, 950, "#3b3733");
  });
  if (!podium.length) text(context, "Nobody scored. A remarkably peaceful party.", 90, 620, 24, 800, "#5f5a52");

  // Party arc
  box(context, 60, 780, 960, 210, PAPER, 10);
  text(context, "📈 THE PARTY ARC", 90, 824, 26, 950);
  text(context, "cheers up · boos down · in play order", 360, 824, 16, 800, "#5f5a52");
  const arcSongs = recap.songs.slice(0, 24);
  const arcMax = Math.max(1, ...arcSongs.map((song) => Math.max(song.cheers, song.boos)));
  const arcLeft = 90; const arcWidth = 900; const midY = 908; const arcHalf = 60;
  context.fillStyle = INK; context.fillRect(arcLeft, midY - 1, arcWidth, 2);
  const columnWidth = arcSongs.length ? Math.min(60, arcWidth / arcSongs.length) : 0;
  arcSongs.forEach((song, index) => {
    const x = arcLeft + index * columnWidth + 4;
    const width = Math.max(6, columnWidth - 8);
    const up = Math.round((song.cheers / arcMax) * arcHalf);
    const down = Math.round((song.boos / arcMax) * arcHalf);
    if (up) { context.fillStyle = "#b5ead7"; context.fillRect(x, midY - up, width, up); context.strokeStyle = INK; context.lineWidth = 2; context.strokeRect(x, midY - up, width, up); }
    if (down) { context.fillStyle = song.skipReason === "boos" ? "#ff5b51" : "#ff8fa3"; context.fillRect(x, midY, width, down); context.strokeStyle = INK; context.lineWidth = 2; context.strokeRect(x, midY, width, down); }
  });
  if (!arcSongs.length) text(context, "No songs. A flat line.", 90, 900, 22, 800, "#5f5a52");

  // Awards
  box(context, 60, 1040, 460, 300, PAPER, 10);
  text(context, "🎖️ AWARDS", 90, 1084, 24, 950);
  recap.awards.slice(0, 5).forEach((entry, index) => {
    const y = 1128 + index * 44;
    context.font = "900 19px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, `${entry.emoji} ${entry.title} · ${entry.winnerAvatar} ${entry.winnerName}`, 400), 90, y, 19, 900);
  });
  if (!recap.awards.length) text(context, "No awards. Try booing harder.", 90, 1140, 20, 800, "#5f5a52");

  // Insights
  box(context, 560, 1040, 460, 300, COLORS[0], 10);
  text(context, "💡 INSIGHTS", 590, 1084, 24, 950);
  const lines = [
    insights.peakWindow ? `🔥 Peak ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(insights.peakWindow.start))}: ${insights.peakWindow.reactions} reactions in 30 min` : "🔥 The room never peaked",
    insights.fastestBoo ? `🚨 Fastest boo: ${insights.fastestBoo.seconds}s into ${insights.fastestBoo.song.title} (${insights.fastestBoo.by.name})` : "🚨 No pre-judged songs",
    insights.survivor ? `🛡️ Survivor: ${insights.survivor.song.title} took ${insights.survivor.boos} boos, finished` : "🛡️ No survivors of note",
    insights.villain ? `💸 Boo economy: ${insights.villain.name} gave ${insights.villain.count} pts` : "💸 Nobody ran a deficit",
    insights.minutes ? `⏱️ ${insights.minutes} min · a reaction every ${insights.reactionPaceSeconds ?? "—"}s` : "⏱️ No clock, no songs",
  ];
  lines.forEach((line, index) => {
    context.font = "850 18px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, line, 400), 590, 1128 + index * 44, 18, 850);
  });

  // Receipts
  box(context, 60, 1390, 960, 200, COLORS[1], 10);
  text(context, "🧾 THE RECEIPTS", 90, 1434, 26, 950);
  const rivalry = recap.rivalry;
  const bromance = recap.bromance;
  const mostBooed = [...recap.players].sort((left, right) => right.boosReceived - left.boosReceived)[0];
  const receipts = [
    rivalry ? `👻 Rivalry: ${rivalry.left.avatar} ${rivalry.left.name} ⚔️ ${rivalry.right.avatar} ${rivalry.right.name} · ${rivalry.count} boo${rivalry.count === 1 ? "" : "s"}` : "👻 No rivalries. Suspiciously polite.",
    bromance ? `🙌 Admiration: ${bromance.left.avatar} ${bromance.left.name} 🤝 ${bromance.right.avatar} ${bromance.right.name} · ${bromance.count} cheer${bromance.count === 1 ? "" : "s"}` : "🙌 No fan clubs formed.",
    mostBooed && mostBooed.boosReceived ? `🪦 Most booed: ${mostBooed.avatar} ${mostBooed.displayName} (${mostBooed.boosReceived}) · critic ${mostBooed.harshestCritic?.avatar ?? ""} ${mostBooed.harshestCritic?.name ?? "nobody"}` : "🪦 Nobody was booed. Was this a party?",
  ];
  receipts.forEach((line, index) => {
    context.font = "850 22px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, line, 900), 90, 1482 + index * 42, 22, 850);
  });

  // Playlist
  box(context, 60, 1640, 960, 210, PAPER, 10);
  text(context, "📼 THE PLAYLIST", 90, 1684, 26, 950);
  const shown = recap.songs.slice(0, 4);
  shown.forEach((song, index) => {
    const y = 1724 + index * 34;
    const outcome = song.status === "played" ? "✅" : song.skipReason === "boos" ? "🪦" : "⏭️";
    context.font = "850 19px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, `${outcome} ${song.title} · ${song.pickerAvatar} ${song.pickerName} · 🙌 ${song.cheers} 👻 ${song.boos}`, 880), 90, y, 19, 850);
  });
  if (recap.songs.length > shown.length) text(context, `…and ${recap.songs.length - shown.length} more on the Hall of Fame page`, 90, 1724 + shown.length * 34, 16, 800, "#5f5a52");
  if (!recap.songs.length) text(context, "No songs reached the speaker.", 90, 1730, 20, 800, "#5f5a52");
  text(context, "hackmusic.fun", 60, 1895, 22, 900, "#5f5a52");
}

export async function shareHallOfFame(recap: PartyRecapPage): Promise<"shared" | "downloaded"> {
  const canvas = document.createElement("canvas");
  drawHallOfFame(canvas, recap);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("The Hall of Fame image could not be exported.")), "image/png"));
  const file = new File([blob], `hackmusic-${recap.code.toLowerCase()}-hall-of-fame.png`, { type: "image/png" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: `${recap.title} · HackMusic Hall of Fame` });
    return "shared";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  return "downloaded";
}
