import { cookies } from "next/headers";
import { encodeCookie, SPOTIFY_OAUTH_COOKIE, spotifyCallbackUrl, spotifyCookieOptions, type SpotifyOAuthState } from "../../../../lib/spotify-auth";

const scopes = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
];

function randomBase64Url(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = (url.searchParams.get("clientId") ?? "").trim();
  const roomCode = (url.searchParams.get("roomCode") ?? "").trim().toUpperCase();
  if (!/^[A-Za-z0-9]{20,64}$/.test(clientId)) return new Response("Invalid Spotify Client ID.", { status: 400 });
  if (!/^[A-Z0-9]{6}$/.test(roomCode)) return new Response("Invalid HackMusic room code.", { status: 400 });

  const verifier = randomBase64Url(64);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let digestBinary = "";
  for (const byte of new Uint8Array(digest)) digestBinary += String.fromCharCode(byte);
  const challenge = btoa(digestBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const state = randomBase64Url(24);
  const redirectUri = spotifyCallbackUrl(request);
  const oauthState: SpotifyOAuthState = { state, verifier, clientId, roomCode, redirectUri };
  const cookieStore = await cookies();
  cookieStore.set(SPOTIFY_OAUTH_COOKIE, encodeCookie(oauthState), spotifyCookieOptions(request, 10 * 60));

  const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
  }).toString();
  return Response.redirect(authorizeUrl, 302);
}
