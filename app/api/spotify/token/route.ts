import { cookies } from "next/headers";
import { decodeCookie, encodeCookie, SPOTIFY_SESSION_COOKIE, spotifyCookieOptions, type SpotifySession } from "../../../../lib/spotify-auth";

type RefreshResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    let session = await decodeCookie<SpotifySession>(cookieStore.get(SPOTIFY_SESSION_COOKIE)?.value);
    if (!session) return Response.json({ error: "Spotify is not connected. Use Connect Spotify on the host page." }, { status: 401 });

    if (session.expiresAt <= Date.now() + 60_000) {
      const refreshResponse = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: session.clientId,
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        }),
      });
      const refreshed = await refreshResponse.json() as RefreshResponse;
      if (!refreshResponse.ok || !refreshed.access_token) {
        cookieStore.delete(SPOTIFY_SESSION_COOKIE);
        return Response.json({ error: "Spotify login expired. Use Connect Spotify on the host page again." }, { status: 401 });
      }
      session = {
        ...session,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? session.refreshToken,
        expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        scope: refreshed.scope ?? session.scope,
      };
      cookieStore.set(SPOTIFY_SESSION_COOKIE, await encodeCookie(session), spotifyCookieOptions(request, 30 * 24 * 60 * 60));
    }

    return Response.json({ accessToken: session.accessToken, expiresAt: session.expiresAt, roomCode: session.roomCode }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Spotify could not be reached right now. Check the connection and try again in a moment." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
