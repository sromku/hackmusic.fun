import type { HostSongHistory, MySong } from "./party-contract";

export function artworkVariant(seed: string) {
  return [...seed].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 7) % 5;
}

export function spotifyTrackWebUrl(value: string) {
  const trackId = value.match(/spotify:track:([A-Za-z0-9]{22})/)?.[1];
  return trackId ? `https://open.spotify.com/track/${trackId}` : "";
}

export function youtubeVideoWebUrl(value: string) {
  const videoId = value.match(/youtube:video:([A-Za-z0-9_-]{11})/)?.[1];
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

export function trackWebUrl(value: string) {
  return spotifyTrackWebUrl(value) || youtubeVideoWebUrl(value);
}

export function trackSourceLabel(value: string) {
  if (value.startsWith("youtube:")) return "YouTube";
  if (value.startsWith("spotify:")) return "Spotify";
  return "";
}

export function formatActivityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatPartyStart(value: string | null, fallback = "when the host is ready") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function durationSeconds(value: string) {
  const match = value.match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

export function durationMilliseconds(value: string) {
  return durationSeconds(value) * 1_000;
}

export function formatMusicDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours} hr ${minutes} min`;
  if (minutes) return `${minutes} min`;
  return totalSeconds ? "Under 1 min" : "0 min";
}

export function formatPlaybackTime(milliseconds: number) {
  const safeSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

export function mySongStatusLabel(song: Pick<MySong, "status" | "skipReason" | "skipPercent">, ended: boolean) {
  if (song.status === "playing") return "⚡ Playing now";
  if (song.status === "played") return "✅ Played";
  if (song.status === "skipped" && song.skipReason === "boos") return song.skipPercent === null ? "👻 Booed off" : `👻 Booed off at ${song.skipPercent}%`;
  if (song.status === "skipped" && song.skipReason === "host") return "⏭️ Skipped by host";
  if (song.status === "skipped") return "⏭️ Skipped";
  if (song.status === "removed") return "🫥 Removed by you";
  return ended ? "📦 Left unplayed" : "🤫 Still waiting";
}

export function hostSongOutcome(track: HostSongHistory) {
  if (track.status === "played") return { label: "✅ PLAYED TO THE END", tone: "played" } as const;
  if (track.skipReason === "boos") return { label: track.skipPercent === null ? "👻 BOOED OFF" : `👻 BOOED OFF AT ${track.skipPercent}%`, tone: "boos" } as const;
  if (track.skipReason === "host") return { label: "⏭️ SKIPPED BY HOST", tone: "host" } as const;
  return { label: "⏭️ SKIPPED", tone: "unknown" } as const;
}
