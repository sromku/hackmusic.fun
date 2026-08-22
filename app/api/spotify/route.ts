type SpotifyOEmbed = {
  title?: string;
  iframe_url?: string;
};

function parseSpotifyTrackUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Paste a valid Spotify track link.");
  }

  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com") {
    throw new Error("Use a link from open.spotify.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const trackIndex = parts.indexOf("track");
  const trackId = trackIndex >= 0 ? parts[trackIndex + 1] : "";
  if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) {
    throw new Error("That is not a Spotify track link.");
  }

  return {
    trackId,
    canonicalUrl: `https://open.spotify.com/track/${trackId}`,
  };
}

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("url") ?? "";
    const { trackId, canonicalUrl } = parseSpotifyTrackUrl(value);
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonicalUrl)}`);
    if (!response.ok) throw new Error("Spotify could not find that track.");
    const data = await response.json() as SpotifyOEmbed;
    if (!data.title) throw new Error("Spotify did not return track details.");

    return Response.json({
      track: {
        id: `spotify:track:${trackId}`,
        title: data.title,
        artist: "Spotify",
        duration: "",
        color: "mint",
      },
      embedUrl: data.iframe_url ?? `https://open.spotify.com/embed/track/${trackId}`,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read that Spotify link." }, { status: 400 });
  }
}
