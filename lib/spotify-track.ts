import { PublicError } from "./public-error";

export type ResolvedSpotifyTrack = {
  id: string;
  trackId: string;
  canonicalUrl: string;
  title: string;
  artist: string;
  duration: string;
  color: "mint";
};

type SpotifyOEmbed = {
  title?: string;
  author_name?: string;
  iframe_url?: string;
};

type SpotifyEmbedEntity = {
  id?: string;
  title?: string;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
};

const trackIdPattern = /^[A-Za-z0-9]{22}$/;

export function parseSpotifyTrackReference(value: string) {
  const reference = value.trim();
  const uriMatch = reference.match(/^spotify:track:([A-Za-z0-9]{22})$/);
  if (uriMatch) {
    const trackId = uriMatch[1];
    return { trackId, uri: `spotify:track:${trackId}`, canonicalUrl: `https://open.spotify.com/track/${trackId}` };
  }

  let url: URL;
  try {
    url = new URL(reference);
  } catch {
    throw new PublicError("Paste a valid Spotify track link.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "open.spotify.com") {
    throw new PublicError("Use a track link from open.spotify.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const trackIndex = parts.indexOf("track");
  const trackId = trackIndex >= 0 ? parts[trackIndex + 1] : "";
  if (!trackId || !trackIdPattern.test(trackId)) throw new PublicError("That link does not contain a valid Spotify track token.");

  return { trackId, uri: `spotify:track:${trackId}`, canonicalUrl: `https://open.spotify.com/track/${trackId}` };
}

export function extractSpotifyTrackId(value: string) {
  try {
    return parseSpotifyTrackReference(value).trackId;
  } catch {
    const uriMatch = value.match(/spotify:track:([A-Za-z0-9]{22})/);
    if (uriMatch) return uriMatch[1];
    const urlMatch = value.match(/open\.spotify\.com\/(?:intl-[^/]+\/)?track\/([A-Za-z0-9]{22})(?:[/?#]|$)/);
    return urlMatch?.[1] ?? "";
  }
}

function parseSpotifyShortUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "open.spotify.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "s" || !/^[A-Za-z0-9_-]{4,64}$/.test(parts[1])) return null;
  return url;
}

export async function resolveSpotifyTrackReference(value: string, fetcher: typeof fetch = fetch) {
  try {
    return parseSpotifyTrackReference(value);
  } catch (reason) {
    const shortUrl = parseSpotifyShortUrl(value);
    if (!shortUrl) throw reason;
    let response: Response;
    try {
      response = await fetcher(`https://open.spotify.com/oembed?url=${encodeURIComponent(shortUrl.toString())}`);
    } catch {
      throw new PublicError("Spotify could not open that short link right now. Try it again, or copy the song link from Spotify.");
    }
    if (!response.ok) {
      throw new PublicError("That Spotify short link could not be opened. In Spotify, open the song itself and copy its song link again.");
    }
    const data = await response.json() as SpotifyOEmbed;
    const trackId = data.iframe_url ? extractSpotifyTrackId(data.iframe_url) : "";
    if (!trackId || !trackIdPattern.test(trackId)) {
      throw new PublicError("That Spotify short link does not point to a playable track. Open the song itself and copy its song link again.");
    }
    return { trackId, uri: `spotify:track:${trackId}`, canonicalUrl: `https://open.spotify.com/track/${trackId}` };
  }
}

export function parseSpotifyEmbedMetadata(html: string, expectedTrackId: string) {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]) as { props?: { pageProps?: { state?: { data?: { entity?: SpotifyEmbedEntity } } } } };
    const entity = data.props?.pageProps?.state?.data?.entity;
    if (!entity || entity.id !== expectedTrackId) return null;
    const artists = entity.artists?.map((artist) => artist.name?.trim()).filter((name): name is string => Boolean(name)) ?? [];
    return {
      title: (entity.title ?? entity.name ?? "").trim(),
      artists,
      durationMs: typeof entity.duration === "number" ? entity.duration : 0,
    };
  } catch {
    return null;
  }
}

function formatDuration(durationMs: number) {
  if (!durationMs) return "";
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export async function resolveSpotifyTrack(value: string): Promise<ResolvedSpotifyTrack> {
  const { trackId, uri, canonicalUrl } = await resolveSpotifyTrackReference(value);
  const [response, embedResponse] = await Promise.all([
    fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`),
    fetch(`https://open.spotify.com/embed/track/${trackId}`),
  ]);
  if (!response.ok) throw new PublicError("Spotify could not find or play that track. Check the link in Spotify, then try again.");
  const data = await response.json() as SpotifyOEmbed;
  if (!data.title) throw new PublicError("Spotify did not return details for that track. Try copying its song link again.");

  const embeddedTrackId = data.iframe_url ? extractSpotifyTrackId(data.iframe_url) : trackId;
  if (embeddedTrackId && embeddedTrackId !== trackId) throw new PublicError("Spotify returned a different track token. Copy the song link again.");
  const embedMetadata = embedResponse.ok ? parseSpotifyEmbedMetadata(await embedResponse.text(), trackId) : null;
  const artist = embedMetadata?.artists.join(", ") || (data.author_name && data.author_name !== "Spotify" ? data.author_name.trim() : "Artist unavailable");

  return {
    id: uri,
    trackId,
    canonicalUrl,
    title: (embedMetadata?.title || data.title).trim().slice(0, 160),
    artist: artist.slice(0, 160),
    duration: formatDuration(embedMetadata?.durationMs ?? 0),
    color: "mint",
  };
}
