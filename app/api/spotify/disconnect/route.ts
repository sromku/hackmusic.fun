import { cookies } from "next/headers";
import { SPOTIFY_OAUTH_COOKIE, SPOTIFY_SESSION_COOKIE } from "../../../../lib/spotify-auth";
import { assertSameOriginMutation, RequestSecurityError } from "../../../../lib/request-security";

export async function POST(request: Request) {
  try { assertSameOriginMutation(request); }
  catch (error) { return Response.json({ error: error instanceof RequestSecurityError ? error.message : "Could not disconnect Spotify." }, { status: error instanceof RequestSecurityError ? error.status : 500 }); }
  const cookieStore = await cookies();
  cookieStore.delete(SPOTIFY_OAUTH_COOKIE);
  cookieStore.delete(SPOTIFY_SESSION_COOKIE);
  return Response.json({ disconnected: true });
}
