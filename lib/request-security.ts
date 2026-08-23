import { ensurePartySchema, getD1 } from "../db";

export class RequestSecurityError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
    this.name = "RequestSecurityError";
  }
}

function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown-network";
}

async function requestKey(request: Request, subject: string) {
  const bytes = new TextEncoder().encode(`hackmusic-request-guard-v2|${requestIp(request)}|${subject}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertSameOriginMutation(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestSecurityError("That request must start from HackMusic.", 403);
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) throw new Error("cross-origin");
  } catch {
    throw new RequestSecurityError("That request must start from HackMusic.", 403);
  }
}

export async function consumeRequestLimit(request: Request, options: { bucket: string; subject?: string; windowMs: number; maximum: number }) {
  await ensurePartySchema();
  const now = Date.now();
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
  const expiresAt = windowStart + options.windowMs;
  const clientKey = await requestKey(request, options.subject ?? "global");
  const d1 = getD1();
  await d1.prepare("DELETE FROM room_creation_limits WHERE expires_at < ?").bind(now).run();
  await d1.prepare(`INSERT INTO room_creation_limits (client_key, window_kind, window_start, attempts, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(client_key, window_kind, window_start)
    DO UPDATE SET attempts = attempts + 1, expires_at = excluded.expires_at`)
    .bind(clientKey, options.bucket, windowStart, expiresAt).run();
  const row = await d1.prepare("SELECT attempts FROM room_creation_limits WHERE client_key = ? AND window_kind = ? AND window_start = ?")
    .bind(clientKey, options.bucket, windowStart).first<{ attempts: number }>();
  if ((row?.attempts ?? options.maximum + 1) > options.maximum) {
    throw new RequestSecurityError("Too many requests. Let the confetti settle, then try again.", 429, Math.max(1, Math.ceil((expiresAt - now) / 1000)));
  }
}

export async function readBoundedJson<T>(request: Request, maximumBytes = 8_192) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new RequestSecurityError("Use a JSON request.", 415);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maximumBytes) throw new RequestSecurityError("That request is too large.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new RequestSecurityError("That request is too large.", 413);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new RequestSecurityError("That request is not valid JSON.", 400);
  }
}
