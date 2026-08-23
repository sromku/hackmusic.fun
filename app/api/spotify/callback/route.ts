import { cookies } from "next/headers";
import { decodeCookie, encodeCookie, SPOTIFY_OAUTH_COOKIE, SPOTIFY_SESSION_COOKIE, spotifyCookieOptions, type SpotifyOAuthState, type SpotifySession } from "../../../../lib/spotify-auth";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

function hostRedirect(request: Request, roomCode: string, result: "connected" | "error", detail?: string) {
  const url = new URL(`/e/${roomCode}/host`, request.url);
  url.searchParams.set("spotify", result);
  if (detail) url.searchParams.set("detail", detail.slice(0, 120));
  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieStore = await cookies();
  const oauth = await decodeCookie<SpotifyOAuthState>(cookieStore.get(SPOTIFY_OAUTH_COOKIE)?.value);
  if (!oauth) return new Response("Spotify login expired. Return to the host page and try again.", { status: 400 });
  cookieStore.delete(SPOTIFY_OAUTH_COOKIE);

  const returnedState = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const spotifyError = requestUrl.searchParams.get("error");
  if (spotifyError) return Response.redirect(hostRedirect(request, oauth.roomCode, "error", spotifyError), 302);
  if (!code || returnedState !== oauth.state) return new Response("Spotify login could not be verified.", { status: 400 });

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: oauth.redirectUri,
      code_verifier: oauth.verifier,
    }),
  });
  const token = await tokenResponse.json() as TokenResponse;
  if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
    return Response.redirect(hostRedirect(request, oauth.roomCode, "error", token.error ?? "token_exchange_failed"), 302);
  }

  const session: SpotifySession = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    clientId: oauth.clientId,
    roomCode: oauth.roomCode,
    scope: token.scope ?? "",
  };
  cookieStore.set(SPOTIFY_SESSION_COOKIE, await encodeCookie(session), spotifyCookieOptions(request, 30 * 24 * 60 * 60));
  return Response.redirect(hostRedirect(request, oauth.roomCode, "connected"), 302);
}
