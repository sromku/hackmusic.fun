#!/usr/bin/env node

import { createHash, webcrypto } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const [inputPath, requestedOutputPath] = process.argv.slice(2);

if (!inputPath) {
  console.error("Usage: npm run backup:decrypt -- <backup.hackmusic-backup> [output.json]");
  process.exit(1);
}

function defaultOutputPath(pathname) {
  return pathname.endsWith(".hackmusic-backup")
    ? `${pathname.slice(0, -".hackmusic-backup".length)}.json`
    : `${pathname}.decrypted.json`;
}

async function hiddenPrompt(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("A terminal is required. You may instead set HACKMUSIC_BACKUP_PASSPHRASE in your environment.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      function onData(chunk) {
        for (const character of chunk) {
          if (character === "\u0003") {
            process.stdin.off("data", onData);
            reject(new Error("Cancelled."));
            return;
          }
          if (character === "\r" || character === "\n") {
            process.stdin.off("data", onData);
            process.stdout.write("\n");
            resolve(value);
            return;
          }
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
        }
      }
      process.stdin.on("data", onData);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function decrypt(envelope, passphrase) {
  if (envelope?.format !== "hackmusic-encrypted-backup" || envelope?.formatVersion !== 1) {
    throw new Error("This is not a supported HackMusic encrypted backup.");
  }
  if (envelope.algorithm?.name !== "AES-GCM" || envelope.keyDerivation?.name !== "PBKDF2" || envelope.keyDerivation?.hash !== "SHA-256") {
    throw new Error("The backup uses an unsupported encryption configuration.");
  }
  const iterations = Number(envelope.keyDerivation.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < 10_000 || iterations > 1_000_000) {
    throw new Error("The backup has an unsafe or invalid key-derivation cost.");
  }
  const material = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(envelope.keyDerivation.salt, "base64"), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  let plaintext;
  try {
    plaintext = Buffer.from(await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(envelope.iv, "base64") },
      key,
      Buffer.from(envelope.ciphertext, "base64"),
    ));
  } catch {
    throw new Error("Decryption failed. The passphrase is wrong or the backup file was damaged.");
  }
  const digest = createHash("sha256").update(plaintext).digest("hex");
  if (digest !== envelope.plaintextSha256) throw new Error("Backup integrity verification failed.");
  JSON.parse(plaintext.toString("utf8"));
  return plaintext;
}

try {
  const envelope = JSON.parse(await readFile(inputPath, "utf8"));
  const passphrase = process.env.HACKMUSIC_BACKUP_PASSPHRASE ?? await hiddenPrompt("Backup passphrase: ");
  delete process.env.HACKMUSIC_BACKUP_PASSPHRASE;
  const plaintext = await decrypt(envelope, passphrase);
  const outputPath = requestedOutputPath ?? defaultOutputPath(inputPath);
  await writeFile(outputPath, plaintext, { flag: "wx", mode: 0o600 });
  console.log(`Verified and decrypted backup to ${outputPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Could not decrypt the backup.");
  process.exitCode = 1;
}
