import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { promisify } from "node:util";
import { requestWorker } from "./support/worker.mjs";
import { createTestD1 } from "./support/test-d1.mjs";

const projectRoot = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

async function loadEncryptionModule() {
  const source = await readFile(new URL("lib/backup-encryption.ts", projectRoot), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("encrypts portable backups locally and rejects the wrong passphrase", async () => {
  const encryption = await loadEncryptionModule();
  const snapshot = {
    format: "hackmusic-portable-backup",
    exportedAt: "2026-08-23T12:00:00.000Z",
    counts: { events: 1, participants: 2 },
    tables: { events: [{ id: "event-secret", host_pin: "host-secret" }] },
  };
  const envelope = await encryption.encryptBackupSnapshot(snapshot, "correct horse battery staple");

  assert.equal(envelope.format, "hackmusic-encrypted-backup");
  assert.equal(envelope.algorithm.name, "AES-GCM");
  assert.equal(envelope.keyDerivation.iterations, 100_000);
  assert.deepEqual(envelope.counts, snapshot.counts);
  assert.doesNotMatch(JSON.stringify(envelope), /event-secret|host-secret/);
  assert.deepEqual(await encryption.decryptBackupEnvelope(envelope, "correct horse battery staple"), snapshot);
  await assert.rejects(encryption.decryptBackupEnvelope(envelope, "definitely the wrong password"));
  await assert.rejects(encryption.encryptBackupSnapshot(snapshot, "too short"), /at least 12/);
});

test("the local recovery tool decrypts and verifies a downloaded backup", async () => {
  const encryption = await loadEncryptionModule();
  const snapshot = { format: "hackmusic-portable-backup", counts: { events: 1 }, tables: { events: [{ id: "recover-me" }] } };
  const envelope = await encryption.encryptBackupSnapshot(snapshot, "a secure recovery phrase");
  const directory = await mkdtemp(join(tmpdir(), "hackmusic-backup-test-"));
  const input = join(directory, "test.hackmusic-backup");
  const output = join(directory, "recovered.json");
  try {
    await writeFile(input, JSON.stringify(envelope));
    await execFileAsync(process.execPath, [new URL("scripts/decrypt-hackmusic-backup.mjs", projectRoot).pathname, input, output], {
      env: { ...process.env, HACKMUSIC_BACKUP_PASSPHRASE: "a secure recovery phrase" },
    });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), snapshot);
    await assert.rejects(
      execFileAsync(process.execPath, [new URL("scripts/decrypt-hackmusic-backup.mjs", projectRoot).pathname, input, join(directory, "wrong.json")], {
        env: { ...process.env, HACKMUSIC_BACKUP_PASSPHRASE: "the wrong recovery phrase" },
      }),
      /Decryption failed/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("exports all durable D1 tables only for the allowlisted ChatGPT owner", async () => {
  const db = createTestD1();
  const bindings = { DB: db, ADMIN_ALLOWED_EMAILS: "sromku@gmail.com" };
  const created = await requestWorker("/api/party", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.60" },
    body: JSON.stringify({ action: "create", title: "Backup Test Party", name: "Backup Host", passcode: "VIBE42" }),
  }, bindings);
  assert.equal(created.status, 201, await created.text());
  db.prepare("INSERT INTO analytics_pageviews (id, visited_at, day, path, visit_hash, referrer_host, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind("pageview-1", "2026-08-23T12:00:00.000Z", "2026-08-23", "/", "visit-hash", "direct", "desktop", "US").run();
  db.prepare("INSERT INTO room_creation_limits (client_key, window_kind, window_start, attempts, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind("temporary-client-key", "day", 1, 1, 2).run();

  const unauthenticated = await requestWorker("/api/backstage-retired-slug/backup", { method: "POST" }, bindings);
  assert.equal(unauthenticated.status, 401);

  const forbidden = await requestWorker("/api/backstage-retired-slug/backup", {
    method: "POST",
    headers: { "oai-authenticated-user-id": "stranger", "oai-authenticated-user-email": "stranger@example.com" },
  }, bindings);
  assert.equal(forbidden.status, 403);

  const crossOrigin = await requestWorker("/api/backstage-retired-slug/backup", {
    method: "POST",
    headers: {
      "oai-authenticated-user-id": "owner",
      "oai-authenticated-user-email": "sromku@gmail.com",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
  }, bindings);
  assert.equal(crossOrigin.status, 403);
  assert.match((await crossOrigin.json()).error, /must start from HackMusic/i);

  const oldGet = await requestWorker("/api/backstage-retired-slug/backup", {
    headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "sromku@gmail.com" },
  }, bindings);
  assert.equal(oldGet.status, 405);

  const response = await requestWorker("/api/backstage-retired-slug/backup", {
    method: "POST",
    headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "sromku@gmail.com" },
  }, bindings);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const { backup } = await response.json();
  assert.equal(backup.format, "hackmusic-portable-backup");
  assert.equal(backup.counts.events, 1);
  assert.equal(backup.counts.participants, 1);
  assert.equal(backup.counts.analytics_pageviews, 1);
  assert.equal(backup.tables.events[0].title, "Backup Test Party");
  assert.ok(backup.tables.events[0].host_pin);
  assert.ok(backup.tables.events[0].join_passcode_hash);
  assert.deepEqual(backup.privacy.excludedTables, ["room_creation_limits", "host_transfers"]);
  assert.equal("room_creation_limits" in backup.tables, false);
  assert.equal("host_transfers" in backup.tables, false);
  assert.doesNotMatch(JSON.stringify(backup), /temporary-client-key/);

  for (let attempt = 2; attempt <= 3; attempt += 1) {
    const allowed = await requestWorker("/api/backstage-retired-slug/backup", {
      method: "POST",
      headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "sromku@gmail.com" },
    }, bindings);
    assert.equal(allowed.status, 200, `attempt ${attempt} should be allowed`);
  }
  const limited = await requestWorker("/api/backstage-retired-slug/backup", {
    method: "POST",
    headers: { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "sromku@gmail.com" },
  }, bindings);
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);
  assert.match((await limited.json()).error, /too many requests/i);
  db.close();
});
