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
  context.font = "950 64px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
  text(context, ellipsize(context, recap.title, 960), 60, 270, 64, 950);

  const stats = [[`${recap.stats.players}`, "HUMANS"], [`${recap.stats.songsPlayed}`, "SONGS"], [`${recap.stats.cheers}`, "CHEERS"], [`${recap.stats.boos}`, "BOOS"]];
  stats.forEach(([value, label], index) => {
    const x = 60 + index * 245;
    box(context, x, 310, 225, 120, COLORS[index % COLORS.length], 8);
    text(context, value, x + 20, 382, 50, 950);
    text(context, label, x + 20, 412, 16, 900, "#3b3733");
  });

  // Podium
  box(context, 60, 480, 960, 300, PAPER, 10);
  text(context, "🏆 PODIUM", 90, 530, 28, 950);
  const podium = recap.players.slice(0, 3);
  const slots = [{ x: 400, h: 150, label: "1", fill: COLORS[0] }, { x: 130, h: 110, label: "2", fill: COLORS[2] }, { x: 670, h: 90, label: "3", fill: COLORS[3] }];
  podium.forEach((player, index) => {
    const slot = slots[index];
    const top = 760 - slot.h;
    box(context, slot.x, top, 280, slot.h, slot.fill, 6);
    text(context, slot.label, slot.x + 16, top + 44, 34, 950);
    context.font = "900 26px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, `${player.avatar} ${ellipsize(context, player.displayName, 200)}`, slot.x + 60, top + 44, 26, 900);
    text(context, `${player.score} pts`, slot.x + 60, top + 76, 22, 950, "#3b3733");
  });
  if (!podium.length) text(context, "Nobody scored. A remarkably peaceful party.", 90, 640, 24, 800, "#5f5a52");

  // Awards
  box(context, 60, 830, 960, 360, PAPER, 10);
  text(context, "🎖️ AWARDS", 90, 880, 28, 950);
  recap.awards.slice(0, 5).forEach((entry, index) => {
    const y = 934 + index * 52;
    context.font = "950 24px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, `${entry.emoji} ${entry.title}`, 90, y, 24, 950);
    context.font = "850 24px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, `${entry.winnerAvatar} ${entry.winnerName === "You" ? "" : entry.winnerName}`.trim() || entry.winnerName, 430), 560, y, 24, 850);
  });
  if (!recap.awards.length) text(context, "No awards. Try booing harder next time.", 90, 950, 22, 800, "#5f5a52");

  // Receipts
  box(context, 60, 1240, 960, 260, COLORS[1], 10);
  text(context, "🧾 THE RECEIPTS", 90, 1290, 28, 950);
  const rivalry = recap.rivalry;
  const bromance = recap.bromance;
  context.font = "850 24px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
  text(context, rivalry ? ellipsize(context, `👻 Rivalry of the night: ${rivalry.left.avatar} ${rivalry.left.name} ⚔️ ${rivalry.right.avatar} ${rivalry.right.name} · ${rivalry.count} boo${rivalry.count === 1 ? "" : "s"} between them`, 900) : "👻 No rivalries. Suspiciously polite.", 90, 1345, 24, 850);
  text(context, bromance ? ellipsize(context, `🙌 Mutual admiration: ${bromance.left.avatar} ${bromance.left.name} 🤝 ${bromance.right.avatar} ${bromance.right.name} · ${bromance.count} cheer${bromance.count === 1 ? "" : "s"}`, 900) : "🙌 No fan clubs formed.", 90, 1395, 24, 850);
  const mostBooed = [...recap.players].sort((left, right) => right.boosReceived - left.boosReceived)[0];
  text(context, mostBooed && mostBooed.boosReceived ? ellipsize(context, `🪦 Most booed human: ${mostBooed.avatar} ${mostBooed.displayName} (${mostBooed.boosReceived}) · harshest critic ${mostBooed.harshestCritic?.avatar ?? ""} ${mostBooed.harshestCritic?.name ?? "nobody"}`, 900) : "🪦 Nobody was booed. Are you sure this was a party?", 90, 1445, 24, 850);

  // Playlist
  box(context, 60, 1550, 960, 300, PAPER, 10);
  text(context, "📼 THE PLAYLIST", 90, 1600, 28, 950);
  const shown = recap.songs.slice(0, 5);
  shown.forEach((song, index) => {
    const y = 1646 + index * 40;
    const outcome = song.status === "played" ? "✅" : song.skipReason === "boos" ? "🪦" : "⏭️";
    context.font = "850 20px ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
    text(context, ellipsize(context, `${outcome} ${song.title} · ${song.pickerAvatar} ${song.pickerName === "You" ? song.pickerName : song.pickerName}`, 880), 90, y, 20, 850);
  });
  if (recap.songs.length > shown.length) text(context, `…and ${recap.songs.length - shown.length} more on the Hall of Fame page`, 90, 1646 + shown.length * 40, 18, 800, "#5f5a52");
  if (!recap.songs.length) text(context, "No songs made it to the speaker.", 90, 1650, 22, 800, "#5f5a52");
  text(context, "hackmusic.fun", 60, 1890, 22, 900, "#5f5a52");
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
