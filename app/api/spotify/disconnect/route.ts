import { cookies } from "next/headers";
import { SPOTIFY_OAUTH_COOKIE, SPOTIFY_SESSION_COOKIE } from "../../../../lib/spotify-auth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(SPOTIFY_OAUTH_COOKIE);
  cookieStore.delete(SPOTIFY_SESSION_COOKIE);
  return Response.json({ disconnected: true });
}
