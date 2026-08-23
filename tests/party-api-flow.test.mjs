import assert from "node:assert/strict";
import test from "node:test";
import { requestWorker } from "./support/worker.mjs";
import { createTestD1 } from "./support/test-d1.mjs";

const db = createTestD1();

async function action(db, body, extraHeaders = {}) {
  const response = await requestWorker("/api/party", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10", ...extraHeaders },
    body: JSON.stringify(body),
  }, { DB: db });
  const data = await response.json();
  return { response, data };
}

async function createRoom(db, overrides = {}) {
  const result = await action(db, { action: "create", title: "Functional Test Party", name: "Host Human", passcode: "VIBE42", ...overrides });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data.room;
}

async function joinRoom(db, room, name, passcode = "VIBE42") {
  const participantId = `p-${crypto.randomUUID()}`;
  const result = await action(db, { action: "join", code: room.code, participantId, name, passcode });
  return { ...result, participantId };
}

function seedTrack(db, room, participantId, options = {}) {
  const event = db.first("SELECT id FROM events WHERE code = ?", room.code);
  const id = options.id ?? `track-${crypto.randomUUID()}`;
  const status = options.status ?? "playing";
  db.prepare("INSERT INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, event.id, participantId, options.uri ?? `spotify:track:${"A".repeat(22)}`, options.title ?? "Test Song", options.artist ?? "Test Artist", options.duration ?? "3:00", "blue", status, new Date().toISOString()).run();
  if (status === "playing") {
    db.prepare("UPDATE events SET current_submission_id = ? WHERE id = ?").bind(id, event.id).run();
    db.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, NULL, 'song_start', ?)")
      .bind(`activity-${crypto.randomUUID()}`, event.id, id, new Date(Date.now() - 90_000).toISOString()).run();
  }
  return id;
}

test("party API enforces passcodes, membership, score visibility, and one reaction per song", async () => {
  const room = await createRoom(db);

  const summaryResponse = await requestWorker(`/api/party?code=${room.code}`, { headers: { "cf-connecting-ip": "203.0.113.11" } }, { DB: db });
  assert.equal(summaryResponse.status, 200);
  assert.equal((await summaryResponse.json()).room.requiresPasscode, true);

  const rejected = await joinRoom(db, room, "Guest Human", "WRONG1");
  assert.equal(rejected.response.status, 401);
  assert.match(rejected.data.error, /do not match/i);

  const joined = await joinRoom(db, room, "Guest Human");
  assert.equal(joined.response.status, 200, JSON.stringify(joined.data));
  assert.equal(joined.data.party.viewer.name, "You");
  assert.equal(joined.data.party.people.every((person) => person.score === null), true);

  seedTrack(db, room, room.participantId);
  const cheer = await action(db, { action: "react", code: room.code, participantId: joined.participantId, kind: "up" });
  assert.equal(cheer.response.status, 200, JSON.stringify(cheer.data));
  assert.equal(cheer.data.party.reactions[0].mine, true);
  assert.equal(cheer.data.party.reactions[0].tone, "up");

  const duplicate = await action(db, { action: "react", code: room.code, participantId: joined.participantId, kind: "down" });
  assert.equal(duplicate.response.status, 409);
  assert.match(duplicate.data.error, /already locked/i);
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", room.participantId).score, 33);

  const ownerVote = await action(db, { action: "react", code: room.code, participantId: room.participantId, kind: "up" });
  assert.equal(ownerVote.response.status, 400);
  assert.match(ownerVote.data.error, /own song/i);
});

test("three distinct boos skip a song, preserve anonymity, and ending freezes the room", async () => {
  const room = await createRoom(db);
  const guests = [];
  for (const name of ["Boo One", "Boo Two", "Boo Three"]) {
    const joined = await joinRoom(db, room, name);
    assert.equal(joined.response.status, 200, JSON.stringify(joined.data));
    guests.push(joined.participantId);
  }
  const trackId = seedTrack(db, room, room.participantId, { duration: "4:00" });
  const nextTrackId = seedTrack(db, room, guests[0], { status: "pending", title: "The Next Secret", uri: `spotify:track:${"B".repeat(22)}` });

  for (const [index, participantId] of guests.entries()) {
    const boo = await action(db, { action: "react", code: room.code, participantId, kind: "down" }, { "cf-connecting-ip": `203.0.113.${20 + index}` });
    assert.equal(boo.response.status, 200, JSON.stringify(boo.data));
    assert.equal(boo.data.skipped, index === 2);
    if (index < 2) {
      assert.equal(boo.data.party.reactions.every((reaction) => reaction.name === "Someone"), true);
    }
  }

  const skipped = db.first("SELECT status, skip_reason, skip_percent FROM submissions WHERE id = ?", trackId);
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.skip_reason, "boos");
  assert.ok(skipped.skip_percent >= 30 && skipped.skip_percent <= 50, `unexpected skip percent ${skipped.skip_percent}`);
  assert.equal(db.first("SELECT current_submission_id FROM events WHERE code = ?", room.code).current_submission_id, nextTrackId);
  assert.equal(db.first("SELECT status FROM submissions WHERE id = ?", nextTrackId).status, "playing");

  const ended = await action(db, { action: "end", code: room.code, participantId: room.participantId, pin: room.hostKey });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.party.status, "ended");
  assert.equal(ended.data.party.people.every((person) => typeof person.score === "number"), true);

  const lateJoin = await joinRoom(db, room, "Too Late");
  assert.equal(lateJoin.response.status, 400);
  assert.match(lateJoin.data.error, /already ended/i);
});

test("party API rejects cross-origin writes and malformed request bodies", async () => {
  const crossOrigin = await requestWorker("/api/party", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    body: JSON.stringify({ action: "create", title: "Bad Room", name: "Bot", passcode: "VIBE42" }),
  }, { DB: db });
  assert.equal(crossOrigin.status, 403);

  const malformed = await requestWorker("/api/party", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }, { DB: db });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /not valid JSON/i);
});

test("a room rejects participant 101 without corrupting existing membership", async () => {
  const room = await createRoom(db, { title: "Capacity Test Party" });
  const event = db.first("SELECT id FROM events WHERE code = ?", room.code);
  const insert = db.prepare("INSERT INTO participants (id, public_id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, 30, ?)");
  for (let index = 1; index < 100; index += 1) {
    insert.bind(`capacity-${index}`, `capacity-public-${index}`, event.id, `Human ${index}`, "H", "blue", new Date().toISOString()).run();
  }

  const rejected = await joinRoom(db, room, "Human 101");
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.data.error, /full/i);
  assert.equal(db.first("SELECT COUNT(*) AS count FROM participants WHERE event_id = ?", event.id).count, 100);
});
