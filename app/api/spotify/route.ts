import { resolveSpotifyTrack } from "../../../lib/spotify-track";

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("url") ?? "";
    const track = await resolveSpotifyTrack(value);

    return Response.json({
      track,
      parsed: { trackId: track.trackId, canonicalUrl: track.canonicalUrl },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not read that Spotify link." }, { status: 400 });
  }
}
