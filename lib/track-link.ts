import { PublicError } from "./public-error";
import { extractSpotifyTrackId, parseSpotifyTrackReference, resolveSpotifyTrack, type ResolvedSpotifyTrack } from "./spotify-track";
import { extractYouTubeVideoId, isYouTubeHost, parseYouTubeVideoReference, resolveYouTubeTrack, type ResolvedYouTubeTrack } from "./youtube-track";

export type TrackSource = "spotify" | "youtube";

export type ResolvedTrack = (ResolvedSpotifyTrack | ResolvedYouTubeTrack) & { source: TrackSource };

export function trackSource(value: string): TrackSource | null {
  const reference = value.trim();
  if (reference.startsWith("spotify:")) return "spotify";
  if (reference.startsWith("youtube:")) return "youtube";
  try {
    const url = new URL(reference);
    const host = url.hostname.toLowerCase();
    if (host === "open.spotify.com" || host === "spotify.link") return "spotify";
    if (isYouTubeHost(host)) return "youtube";
  } catch {
    // Not a URL: fall through to the pattern checks below.
  }
  if (extractSpotifyTrackId(reference)) return "spotify";
  if (extractYouTubeVideoId(reference)) return "youtube";
  return null;
}

export function parseTrackReference(value: string) {
  const source = trackSource(value);
  if (source === "spotify") {
    const spotify = parseSpotifyTrackReference(value);
    return { source, uri: spotify.uri, canonicalUrl: spotify.canonicalUrl };
  }
  if (source === "youtube") {
    const youtube = parseYouTubeVideoReference(value);
    return { source, uri: youtube.uri, canonicalUrl: youtube.canonicalUrl };
  }
  throw new PublicError("Paste a Spotify track link or a YouTube video link.");
}

export function trackWebUrl(value: string) {
  const spotifyId = extractSpotifyTrackId(value);
  if (spotifyId) return `https://open.spotify.com/track/${spotifyId}`;
  const youtubeId = extractYouTubeVideoId(value);
  if (youtubeId) return `https://www.youtube.com/watch?v=${youtubeId}`;
  return "";
}

export async function resolveTrack(value: string): Promise<ResolvedTrack> {
  const source = trackSource(value);
  if (source === "spotify") return { ...await resolveSpotifyTrack(value), source };
  if (source === "youtube") return { ...await resolveYouTubeTrack(value), source };
  throw new PublicError("Paste a Spotify track link or a YouTube video link.");
}
