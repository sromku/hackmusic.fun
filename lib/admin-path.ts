/** The secret admin path segment must be long enough that guessing it is hopeless. */
export const MIN_ADMIN_PATH_LENGTH = 16;

/** Constant-time comparison of a requested path segment against the configured secret. Unconfigured or too-short secrets never match. */
export function adminPathMatches(candidate: string, configured: string) {
  const secret = configured.trim();
  if (secret.length < MIN_ADMIN_PATH_LENGTH || !/^[A-Za-z0-9_-]+$/.test(secret)) return false;
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
