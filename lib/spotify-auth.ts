export const SPOTIFY_OAUTH_COOKIE = "hackmusic_spotify_oauth";
export const SPOTIFY_SESSION_COOKIE = "hackmusic_spotify_session";

export type SpotifyOAuthState = {
  state: string;
  verifier: string;
  clientId: string;
  roomCode: string;
  redirectUri: string;
};

export type SpotifySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  roomCode: string;
  scope: string;
};

export function encodeCookie(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeCookie<T>(value?: string) {
  if (!value) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export function spotifyCallbackUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? requestUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(":", "");
  return `${protocol}://${host}/api/spotify/callback`;
}

export function spotifyCookieOptions(request: Request, maxAge: number) {
  return {
    httpOnly: true,
    secure: spotifyCallbackUrl(request).startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
