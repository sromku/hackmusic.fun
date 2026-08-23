import { ensurePartySchema, getD1 } from "../db";
import { assertSameOriginMutation, consumeRequestLimit, RequestSecurityError } from "./request-security";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const limits = [
  { kind: "burst", windowMs: FIFTEEN_MINUTES, maximum: 5 },
  { kind: "daily", windowMs: ONE_DAY, maximum: 20 },
] as const;

export class RoomCreationGuardError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter?: number) {
    super(message);
    this.name = "RoomCreationGuardError";
  }
}

async function anonymousClientKey(request: Request) {
  const forwarded = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown-network";
  const bytes = new TextEncoder().encode(`hackmusic-room-guard-v1|${forwarded}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeLimit(clientKey: string, kind: string, windowMs: number, maximum: number, now: number) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = windowStart + windowMs;
  const d1 = getD1();
  await d1.prepare(`INSERT INTO room_creation_limits (client_key, window_kind, window_start, attempts, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(client_key, window_kind, window_start)
    DO UPDATE SET attempts = attempts + 1, expires_at = excluded.expires_at`)
    .bind(clientKey, kind, windowStart, expiresAt).run();
  const row = await d1.prepare(`SELECT attempts FROM room_creation_limits
    WHERE client_key = ? AND window_kind = ? AND window_start = ?`)
    .bind(clientKey, kind, windowStart).first<{ attempts: number }>();
  if ((row?.attempts ?? maximum + 1) > maximum) {
    const retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    throw new RoomCreationGuardError("Too many rooms were created from this network. Let the confetti settle, then try again.", 429, retryAfter);
  }
}

export async function protectRoomCreation(request: Request, website = "") {
  if (website.trim()) {
    throw new RoomCreationGuardError("Could not create the room.", 400);
  }

  try { assertSameOriginMutation(request); }
  catch (error) {
    if (error instanceof RequestSecurityError) throw new RoomCreationGuardError("Room creation must start from HackMusic.", error.status);
    throw error;
  }

  await ensurePartySchema();
  const now = Date.now();
  const d1 = getD1();
  await d1.prepare("DELETE FROM room_creation_limits WHERE expires_at < ?").bind(now).run();
  const clientKey = await anonymousClientKey(request);
  for (const limit of limits) {
    await consumeLimit(clientKey, limit.kind, limit.windowMs, limit.maximum, now);
  }
}

export async function protectPartyAction(request: Request, action: string, code: string, participantId = "") {
  assertSameOriginMutation(request);
  const normalizedCode = code.trim().toUpperCase();
  if (action === "join") {
    await consumeRequestLimit(request, { bucket: "join-room", subject: normalizedCode, windowMs: FIFTEEN_MINUTES, maximum: 60 });
    return;
  }
  if (action === "submit") {
    await consumeRequestLimit(request, { bucket: "submit-track-room", subject: normalizedCode, windowMs: 60_000, maximum: 30 });
    if (participantId) await consumeRequestLimit(request, { bucket: "submit-track-person", subject: `${normalizedCode}|${participantId}`, windowMs: 60_000, maximum: 6 });
    return;
  }
  if (action === "remove") {
    await consumeRequestLimit(request, { bucket: "remove-track-room", subject: normalizedCode, windowMs: 60_000, maximum: 60 });
    if (participantId) await consumeRequestLimit(request, { bucket: "remove-track-person", subject: `${normalizedCode}|${participantId}`, windowMs: 60_000, maximum: 12 });
    return;
  }
  if (action === "react") {
    await consumeRequestLimit(request, { bucket: "react-room", subject: normalizedCode, windowMs: 60_000, maximum: 120 });
    if (participantId) await consumeRequestLimit(request, { bucket: "react-person", subject: `${normalizedCode}|${participantId}`, windowMs: 60_000, maximum: 12 });
    return;
  }
  if (["start", "skip", "advance", "end", "queueMode", "passcode"].includes(action)) {
    await consumeRequestLimit(request, { bucket: "host-control", subject: normalizedCode, windowMs: 60_000, maximum: 90 });
  }
}

export async function protectRoomLookup(request: Request) {
  await consumeRequestLimit(request, { bucket: "room-lookup", windowMs: FIFTEEN_MINUTES, maximum: 180 });
}
