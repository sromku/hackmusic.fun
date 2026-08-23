import { env } from "cloudflare:workers";
import { readAdminOverview, readAdminRoom } from "../../../db/admin";

export const dynamic = "force-dynamic";

function runtimeSecret() {
  return (env as unknown as { ADMIN_API_KEY?: string }).ADMIN_API_KEY?.trim() ?? "";
}

async function secretsMatch(left: string, right: string) {
  const encode = (value: string) => new TextEncoder().encode(value);
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(left)),
    crypto.subtle.digest("SHA-256", encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

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
  const expected = runtimeSecret();
  if (!expected) return json({ error: "Admin access is not configured." }, 503);
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!supplied || !(await secretsMatch(supplied, expected))) {
    return json({ error: "Admin access denied." }, 401, { "www-authenticate": "Bearer" });
  }

  try {
    const code = new URL(request.url).searchParams.get("code")?.trim();
    return json(code ? await readAdminRoom(code) : await readAdminOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read admin data.";
    const status = message.includes("not found") ? 404 : message.includes("six-character") ? 400 : 500;
    return json({ error: message }, status);
  }
}
