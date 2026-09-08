import { readAdminOverview, readAdminRoom } from "../../../../db/admin";
import { adminAccessForEmail, isAdminPath } from "../../../admin-auth";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { publicErrorDetails } from "../../../../lib/public-error";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow, noarchive",
      ...extraHeaders,
    },
  });
}

type RouteContext = { params: Promise<{ slug: string }> };

function notFoundResponse() {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(request: Request, { params }: RouteContext) {
  if (!isAdminPath((await params).slug)) return notFoundResponse();
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in with ChatGPT to continue." }, 401);
  const access = adminAccessForEmail(user.email);
  if (!access.configured) return json({ error: "The admin owner allowlist is not configured." }, 503);
  if (!access.allowed) return json({ error: "This ChatGPT account is not allowed to access the HackMusic owner dashboard." }, 403);

  try {
    const code = new URL(request.url).searchParams.get("code")?.trim();
    return json(code ? await readAdminRoom(code) : await readAdminOverview());
  } catch (error) {
    const detail = publicErrorDetails(error, "We could not load the owner dashboard right now. Refresh and try again.");
    return json({ error: detail.message }, detail.status);
  }
}
