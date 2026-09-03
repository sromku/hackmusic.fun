import type { PartyAward } from "./party-contract";

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
