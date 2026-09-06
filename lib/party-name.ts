export const ROOM_CODE_AS_NAME_MESSAGE = "🎟️ Bold disguise, but that’s the room code—not a human name. Try the thing people actually call you.";
export const PASSCODE_AS_NAME_MESSAGE = "🔐 That’s the secret knock, not your name. The bouncer needs both.";

/** Compare credentials forgivingly so pasted decoration such as **ABC123** cannot sneak through. */
export function partyCredentialToken(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function partyNameCredentialError(name: string, roomCode: string, passcode = "") {
  const nameToken = partyCredentialToken(name);
  if (!nameToken) return "";
  if (nameToken === partyCredentialToken(roomCode)) return ROOM_CODE_AS_NAME_MESSAGE;
  if (passcode && nameToken === partyCredentialToken(passcode)) return PASSCODE_AS_NAME_MESSAGE;
  return "";
}
