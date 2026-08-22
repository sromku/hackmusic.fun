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
    throw new Error("Paste a valid Spotify track link.");
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "open.spotify.com") {
    throw new Error("Use a track link from open.spotify.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const trackIndex = parts.indexOf("track");
  const trackId = trackIndex >= 0 ? parts[trackIndex + 1] : "";
  if (!trackId || !trackIdPattern.test(trackId)) throw new Error("That link does not contain a valid Spotify track token.");

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

export async function resolveSpotifyTrack(value: string): Promise<ResolvedSpotifyTrack> {
  const { trackId, uri, canonicalUrl } = parseSpotifyTrackReference(value);
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`);
  if (!response.ok) throw new Error("Spotify could not find or play that track.");
  const data = await response.json() as SpotifyOEmbed;
  if (!data.title) throw new Error("Spotify did not return details for that track.");

  const embeddedTrackId = data.iframe_url ? extractSpotifyTrackId(data.iframe_url) : trackId;
  if (embeddedTrackId && embeddedTrackId !== trackId) throw new Error("Spotify returned a different track token. Copy the song link again.");

  return {
    id: uri,
    trackId,
    canonicalUrl,
    title: data.title.trim().slice(0, 160),
    artist: data.author_name?.trim().slice(0, 160) || "Spotify",
    duration: "",
    color: "mint",
  };
}
