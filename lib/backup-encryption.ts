export const ENCRYPTED_BACKUP_FORMAT = "hackmusic-encrypted-backup";
export const ENCRYPTED_BACKUP_VERSION = 1;
export const BACKUP_PBKDF2_ITERATIONS = 100_000;

export type EncryptedBackupEnvelope = {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  formatVersion: typeof ENCRYPTED_BACKUP_VERSION;
  createdAt: string;
  algorithm: { name: "AES-GCM"; keyLength: 256 };
  keyDerivation: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  iv: string;
  plaintextSha256: string;
  counts: Record<string, number>;
  ciphertext: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(passphrase: string, salt: Uint8Array, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: BACKUP_PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function encryptBackupSnapshot(snapshot: unknown, passphrase: string): Promise<EncryptedBackupEnvelope> {
  if (passphrase.length < 12) throw new Error("Use a backup passphrase with at least 12 characters.");
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ["encrypt"]);
  const [ciphertext, digest] = await Promise.all([
    crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
    crypto.subtle.digest("SHA-256", plaintext),
  ]);
  const counts = typeof snapshot === "object" && snapshot && "counts" in snapshot
    ? (snapshot as { counts: Record<string, number> }).counts
    : {};

  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    formatVersion: ENCRYPTED_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    algorithm: { name: "AES-GCM", keyLength: 256 },
    keyDerivation: {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: BACKUP_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    iv: bytesToBase64(iv),
    plaintextSha256: bytesToHex(new Uint8Array(digest)),
    counts,
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackupEnvelope(envelope: EncryptedBackupEnvelope, passphrase: string): Promise<unknown> {
  if (envelope.format !== ENCRYPTED_BACKUP_FORMAT || envelope.formatVersion !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error("This is not a supported HackMusic encrypted backup.");
  }
  const salt = base64ToBytes(envelope.keyDerivation.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveKey(passphrase, salt, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    base64ToBytes(envelope.ciphertext),
  );
  const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", plaintext)));
  if (digest !== envelope.plaintextSha256) throw new Error("Backup integrity verification failed.");
  return JSON.parse(new TextDecoder().decode(plaintext));
}
