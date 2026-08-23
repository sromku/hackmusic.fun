import { PublicError } from "./public-error";

const encoder = new TextEncoder();
const iterations = 100_000;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function normalizeRoomPasscode(value: string) {
  return value.trim().toUpperCase();
}

export function validateRoomPasscode(value: string) {
  const passcode = normalizeRoomPasscode(value);
  if (!/^[A-Z0-9]{4,12}$/.test(passcode)) throw new PublicError("Use a 4–12 character room passcode with letters and numbers only.");
  return passcode;
}

async function derive(passcode: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(passcode), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashRoomPasscode(value: string) {
  const passcode = validateRoomPasscode(value);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: base64Url(await derive(passcode, salt)), salt: base64Url(salt) };
}

export async function verifyRoomPasscode(value: string, expectedHash: string, encodedSalt: string) {
  let actual: Uint8Array;
  let expected: Uint8Array;
  try {
    actual = await derive(normalizeRoomPasscode(value), fromBase64Url(encodedSalt));
    expected = fromBase64Url(expectedHash);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}
