import { PublicError } from "./public-error";

export type ResolvedYouTubeTrack = {
  id: string;
  videoId: string;
  canonicalUrl: string;
  title: string;
  artist: string;
  duration: string;
  color: "coral";
};

type YouTubeOEmbed = {
  title?: string;
  author_name?: string;
};

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export function isYouTubeHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "youtu.be" || youtubeHosts.has(host);
}

function youtubeReference(videoId: string) {
  return { videoId, uri: `youtube:video:${videoId}`, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export function parseYouTubeVideoReference(value: string) {
  const reference = value.trim();
  const uriMatch = reference.match(/^youtube:video:([A-Za-z0-9_-]{11})$/);
  if (uriMatch) return youtubeReference(uriMatch[1]);

  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new PublicError("Paste a valid YouTube video link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PublicError("Use a video link from youtube.com or youtu.be.");
  if (!isYouTubeHost(url.hostname)) throw new PublicError("Use a video link from youtube.com or youtu.be.");

  const parts = url.pathname.split("/").filter(Boolean);
  let videoId = "";
  if (url.hostname.toLowerCase() === "youtu.be") {
    videoId = parts[0] ?? "";
  } else if (parts[0] === "watch" || parts.length === 0) {
    videoId = url.searchParams.get("v") ?? "";
  } else if (["shorts", "embed", "live", "v"].includes(parts[0])) {
    videoId = parts[1] ?? "";
  } else {
    videoId = url.searchParams.get("v") ?? "";
  }
  if (!videoId || !videoIdPattern.test(videoId)) throw new PublicError("That link does not contain a valid YouTube video ID. Open the video itself and copy its link again.");
  return youtubeReference(videoId);
}

export function extractYouTubeVideoId(value: string) {
  try {
    return parseYouTubeVideoReference(value).videoId;
  } catch {
    return value.match(/youtube:video:([A-Za-z0-9_-]{11})/)?.[1] ?? "";
  }
}

export function youtubeThumbnailUrl(videoId: string) {
  return videoIdPattern.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : "";
}

const noiseSegment = /\s*[([{][^)\]}]*\b(official|lyrics?|audio|video|visuali[sz]er|hd|4k|remaster(?:ed)?|music video|explicit|clean|hq|live at|sub(?:titulado|s)?)\b[^)\]}]*[)\]}]/gi;

export function cleanYouTubeTitle(title: string) {
  const cleaned = title.replace(noiseSegment, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || title.trim();
}

export function cleanYouTubeChannel(channel: string) {
  return channel.replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").replace(/\s*official$/i, "").trim();
}

function formatDuration(totalSeconds: number) {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return "";
  const seconds = Math.round(totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function parseIsoDuration(value: string) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function parseYouTubeWatchMetadata(html: string) {
  const lengthMatch = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
  const isoMatch = html.match(/<meta\s+itemprop=["']duration["']\s+content=["'](PT[^"']+)["']/i);
  const durationSeconds = lengthMatch ? Number(lengthMatch[1]) : isoMatch ? parseIsoDuration(isoMatch[1]) : 0;
  const liveMatch = html.match(/"isLiveContent"\s*:\s*(true|false)/);
  return { durationSeconds, isLive: liveMatch?.[1] === "true" };
}

async function fetchWatchMetadata(canonicalUrl: string, fetcher: typeof fetch) {
  try {
    const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(4_000) : undefined;
    const response = await fetcher(`${canonicalUrl}&hl=en`, { signal, headers: { "accept-language": "en", "user-agent": "Mozilla/5.0 (compatible; HackMusic/1.0)" } });
    if (!response.ok) return null;
    return parseYouTubeWatchMetadata(await response.text());
  } catch {
    return null;
  }
}

export async function resolveYouTubeTrack(value: string, fetcher: typeof fetch = fetch): Promise<ResolvedYouTubeTrack> {
  const { videoId, uri, canonicalUrl } = parseYouTubeVideoReference(value);
  const [oembedResponse, watchMetadata] = await Promise.all([
    fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`).catch(() => null),
    fetchWatchMetadata(canonicalUrl, fetcher),
  ]);
  if (!oembedResponse) throw new PublicError("YouTube could not be reached right now. Try the link again in a moment.");
  if (oembedResponse.status === 401 || oembedResponse.status === 403) throw new PublicError("That YouTube video is private or cannot be embedded, so HackMusic cannot play it. Pick another video.");
  if (oembedResponse.status === 404 || oembedResponse.status === 400) throw new PublicError("YouTube could not find that video. Open it on YouTube and copy its link again.");
  if (!oembedResponse.ok) throw new PublicError("YouTube did not confirm that video. Check the link and try again.");
  const data = await oembedResponse.json() as YouTubeOEmbed;
  if (!data.title) throw new PublicError("YouTube did not return details for that video. Copy its link again.");
  if (watchMetadata?.isLive) throw new PublicError("Live streams cannot join the queue. Pick a regular video.");

  const channel = cleanYouTubeChannel(data.author_name ?? "");
  return {
    id: uri,
    videoId,
    canonicalUrl,
    title: cleanYouTubeTitle(data.title).slice(0, 160),
    artist: (channel || "YouTube").slice(0, 160),
    duration: formatDuration(watchMetadata?.durationSeconds ?? 0),
    color: "coral",
  };
}
