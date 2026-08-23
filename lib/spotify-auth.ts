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

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function cookieKey() {
  const secret = process.env.SPOTIFY_COOKIE_SECRET ?? "";
  if (secret.length < 32) throw new Error("Spotify cookie encryption is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encodeCookie(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cookieKey(), plaintext);
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decodeCookie<T>(value?: string) {
  if (!value) return null;
  try {
    const [version, encodedIv, encodedCiphertext] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedCiphertext) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(encodedIv) }, await cookieKey(), fromBase64Url(encodedCiphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
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
