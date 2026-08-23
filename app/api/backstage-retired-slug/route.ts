import { readAdminOverview, readAdminRoom } from "../../../db/admin";
import { adminAccessForEmail } from "../../admin-auth";
import { getChatGPTUser } from "../../chatgpt-auth";

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

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in with ChatGPT to continue." }, 401);
  const access = adminAccessForEmail(user.email);
  if (!access.configured) return json({ error: "The admin owner allowlist is not configured." }, 503);
  if (!access.allowed) return json({ error: "This ChatGPT account is not allowed to access the HackMusic owner dashboard." }, 403);

  try {
    const code = new URL(request.url).searchParams.get("code")?.trim();
    return json(code ? await readAdminRoom(code) : await readAdminOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read admin data.";
    const status = message.includes("not found") ? 404 : message.includes("six-character") ? 400 : 500;
    return json({ error: message }, status);
  }
}
