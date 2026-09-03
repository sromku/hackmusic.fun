/**
 * Guest identity normally lives in localStorage under the room code, so every tab in one browser is the
 * same human. A `?persona=` query parameter scopes that key, which lets one browser hold several test
 * guests at once (see /lab/CODE). Personas are only a testing convenience: the server still applies the
 * passcode, membership, and one-vote rules to each participant id exactly as before.
 */
export function normalizePersona(value: string | null | undefined) {
  return (value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

export function personaFromSearch(search: string) {
  try {
    return normalizePersona(new URLSearchParams(search).get("persona"));
  } catch {
    return "";
  }
}

export function participantStorageKey(code: string, persona = "") {
  const scope = normalizePersona(persona);
  return scope ? `hackmusic:${code}:participant:${scope}` : `hackmusic:${code}:participant`;
}

export function personaDisplayName(persona: string) {
  const scope = normalizePersona(persona);
  if (!scope) return "";
  const spaced = scope.replace(/[-_]+/g, " ").trim();
  return spaced.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 24);
}
