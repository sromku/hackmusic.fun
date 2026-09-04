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
  assert.equal(joined.data.party.viewerDisplayName, "Guest Human");
  assert.equal(joined.data.party.people.every((person) => person.score === null), true);

  const avatar = await action(db, { action: "avatar", code: room.code, participantId: joined.participantId, avatarEmoji: "🦊" });
  assert.equal(avatar.response.status, 200, JSON.stringify(avatar.data));
  const renamedHuman = await action(db, { action: "profileName", code: room.code, participantId: joined.participantId, name: "  Disco Alias  " });
  assert.equal(renamedHuman.response.status, 200, JSON.stringify(renamedHuman.data));
  assert.equal(renamedHuman.data.party.viewerDisplayName, "Disco Alias");
  assert.equal(renamedHuman.data.party.viewer.name, "You");
  const storedHuman = db.first("SELECT display_name, initials FROM participants WHERE id = ?", joined.participantId);
  assert.equal(storedHuman.display_name, "Disco Alias");
  assert.equal(storedHuman.initials, "🦊");
  const hostViewResponse = await requestWorker(`/api/party?code=${room.code}`, { headers: { "x-hackmusic-participant": room.participantId, "cf-connecting-ip": "203.0.113.12" } }, { DB: db });
  const hostView = await hostViewResponse.json();
  assert.equal(hostView.party.people.some((person) => person.name === "Disco Alias"), true);

  const invalidName = await action(db, { action: "profileName", code: room.code, participantId: joined.participantId, name: "X" });
  assert.equal(invalidName.response.status, 400);
  assert.match(invalidName.data.error, /between 2 and 24/i);

  const impostorRename = await action(db, { action: "profileName", code: room.code, participantId: `p-${crypto.randomUUID()}`, name: "Not Invited" });
  assert.equal(impostorRename.response.status, 401);

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

test("YouTube videos share the queue with Spotify tracks and record boo-skip progress", async () => {
  const created = await action(db, { action: "create", title: "YouTube Room Party", name: "Host Human", passcode: "VIBE42", musicSource: "youtube" }, { "cf-connecting-ip": "203.0.113.90" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const room = created.data.room;
  const guests = [];
  for (const name of ["Video One", "Video Two", "Video Three"]) {
    const joined = await joinRoom(db, room, name);
    assert.equal(joined.response.status, 200, JSON.stringify(joined.data));
    guests.push(joined.participantId);
  }
  const videoId = seedTrack(db, room, room.participantId, { uri: "youtube:video:dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley", duration: "3:33" });
  const nextSpotifyId = seedTrack(db, room, guests[0], { status: "pending", uri: `spotify:track:${"C".repeat(22)}`, title: "Spotify Follow-up" });

  const hostViewResponse = await requestWorker(`/api/party?code=${room.code}`, { headers: { "x-hackmusic-participant": room.participantId, "x-hackmusic-host-key": room.hostKey, "cf-connecting-ip": "203.0.113.30" } }, { DB: db });
  const hostView = await hostViewResponse.json();
  assert.equal(hostViewResponse.status, 200, JSON.stringify(hostView));
  assert.equal(hostView.party.currentTrack.id, "youtube:video:dQw4w9WgXcQ");
  assert.equal(hostView.party.currentTrack.artist, "Rick Astley");
  assert.equal(hostView.party.queuedTracks[0].id, `spotify:track:${"C".repeat(22)}`);

  const badLink = await action(db, { action: "submit", code: room.code, participantId: guests[1], trackUrl: "https://soundcloud.com/someone/some-song" });
  assert.equal(badLink.response.status, 400);
  assert.match(badLink.data.error, /Spotify track link or a YouTube video link/);
  const badVideo = await action(db, { action: "submit", code: room.code, participantId: guests[1], trackUrl: "https://www.youtube.com/playlist?list=PL123" });
  assert.equal(badVideo.response.status, 400);
  assert.match(badVideo.data.error, /valid YouTube video ID/);
  const wrongService = await action(db, { action: "submit", code: room.code, participantId: guests[1], trackUrl: "https://open.spotify.com/track/5lf9LK4eETye6DsPUJpHDB" });
  assert.equal(wrongService.response.status, 400);
  assert.match(wrongService.data.error, /YouTube only/);
  assert.equal(created.data.room.musicSource, "youtube");
  assert.equal(hostView.party.musicSource, "youtube");

  for (const [index, participantId] of guests.entries()) {
    const boo = await action(db, { action: "react", code: room.code, participantId, kind: "down" }, { "cf-connecting-ip": `203.0.113.${40 + index}` });
    assert.equal(boo.response.status, 200, JSON.stringify(boo.data));
  }
  assert.equal(db.first("SELECT status, skip_reason FROM submissions WHERE id = ?", videoId).skip_reason, "boos");
  assert.equal(db.first("SELECT current_submission_id FROM events WHERE code = ?", room.code).current_submission_id, nextSpotifyId);

  const progress = await action(db, { action: "skipProgress", code: room.code, participantId: room.participantId, pin: room.hostKey, trackId: "youtube:video:dQw4w9WgXcQ", skipPercent: 61.4 });
  assert.equal(progress.response.status, 200, JSON.stringify(progress.data));
  assert.equal(db.first("SELECT skip_percent FROM submissions WHERE id = ?", videoId).skip_percent, 61);
  assert.equal(progress.data.party.songHistory[0].skipPercent, 61);
});

test("a room is locked to one music source chosen at creation", async () => {
  const invalid = await action(db, { action: "create", title: "Nowhere Party", name: "Host Human", passcode: "VIBE42", musicSource: "soundcloud" }, { "cf-connecting-ip": "203.0.113.91" });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /Spotify or YouTube/);

  const created = await action(db, { action: "create", title: "Spotify Room Party", name: "Host Human", passcode: "VIBE42" }, { "cf-connecting-ip": "203.0.113.92" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.room.musicSource, "spotify");
  const summaryResponse = await requestWorker(`/api/party?code=${created.data.room.code}`, { headers: { "cf-connecting-ip": "203.0.113.93" } }, { DB: db });
  assert.equal((await summaryResponse.json()).room.musicSource, "spotify");

  const guest = await joinRoom(db, created.data.room, "Video Fan");
  assert.equal(guest.response.status, 200, JSON.stringify(guest.data));
  assert.equal(guest.data.party.musicSource, "spotify");
  const rejected = await action(db, { action: "submit", code: created.data.room.code, participantId: guest.participantId, trackUrl: "https://youtu.be/dQw4w9WgXcQ" });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.data.error, /Spotify only/);
  assert.equal(db.first("SELECT COUNT(*) AS count FROM submissions WHERE event_id = (SELECT id FROM events WHERE code = ?)", created.data.room.code).count, 0);
});

test("power-ups, guesses, flair, themes, and awards make the party more fun without breaking the rules", async () => {
  const created = await action(db, { action: "create", title: "Fun Layer Party", name: "Host Human", passcode: "VIBE42" }, { "cf-connecting-ip": "203.0.113.100" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const room = created.data.room;
  const guests = [];
  for (const name of ["Fan One", "Fan Two", "Fan Three", "Fan Four"]) {
    const joined = await joinRoom(db, room, name);
    assert.equal(joined.response.status, 200, JSON.stringify(joined.data));
    guests.push({ id: joined.participantId, publicId: joined.data.party.viewer.id, name });
  }
  const hostPublicId = created.data.room.participantId;
  const guestView = async (participantId) => (await (await requestWorker(`/api/party?code=${room.code}`, { headers: { "x-hackmusic-participant": participantId, "cf-connecting-ip": "203.0.113.102" } }, { DB: db })).json()).party;

  // Theme: host only, trimmed, clearable.
  const themeRejected = await action(db, { action: "theme", code: room.code, participantId: guests[0].id, pin: "nope", theme: "Guilty pleasures" });
  assert.equal(themeRejected.response.status, 403);
  const themed = await action(db, { action: "theme", code: room.code, participantId: room.participantId, pin: room.hostKey, theme: "  Guilty   pleasures  " });
  assert.equal(themed.response.status, 200, JSON.stringify(themed.data));
  assert.equal(themed.data.party.theme, "Guilty pleasures");
  assert.equal((await guestView(guests[0].id)).theme, "Guilty pleasures");

  // Song by guest one is playing. Guest one shields it; the first boo costs nothing and a fourth boo is needed to skip.
  const songId = seedTrack(db, room, guests[0].id, { duration: "3:00", title: "Shielded Anthem" });
  seedTrack(db, room, guests[1].id, { status: "pending", uri: `spotify:track:${"D".repeat(22)}`, title: "Second Song" });
  const before = db.first("SELECT score FROM participants WHERE id = ?", guests[0].id).score;
  const ownerView = await guestView(guests[0].id);
  assert.equal(ownerView.powerUps.shieldUsableNow, true);
  assert.deepEqual(ownerView.guessOptions, []);
  const notOwnerShield = await action(db, { action: "shield", code: room.code, participantId: guests[1].id });
  assert.equal(notOwnerShield.response.status, 400);
  const shielded = await action(db, { action: "shield", code: room.code, participantId: guests[0].id });
  assert.equal(shielded.response.status, 200, JSON.stringify(shielded.data));
  assert.equal(shielded.data.party.currentTrack.shielded, true);
  assert.equal(shielded.data.party.powerUps.shieldAvailable, false);
  const again = await action(db, { action: "shield", code: room.code, participantId: guests[0].id });
  assert.equal(again.response.status, 400);

  // Guesses: options exclude the viewer, the submitter cannot guess, guesses can change until the song ends.
  const guesserView = await guestView(guests[1].id);
  assert.equal(guesserView.guessOptions.some((person) => person.id === guesserView.viewer.id), false);
  assert.ok(guesserView.guessOptions.some((person) => person.id === guests[0].publicId));
  const ownerGuess = await action(db, { action: "guess", code: room.code, participantId: guests[0].id, guessParticipantId: guests[1].publicId });
  assert.equal(ownerGuess.response.status, 400);
  const wrongFirst = await action(db, { action: "guess", code: room.code, participantId: guests[1].id, guessParticipantId: guests[2].publicId });
  assert.equal(wrongFirst.response.status, 200, JSON.stringify(wrongFirst.data));
  assert.equal(wrongFirst.data.party.myGuess, guests[2].publicId);
  const rightGuess = await action(db, { action: "guess", code: room.code, participantId: guests[1].id, guessParticipantId: guests[0].publicId });
  assert.equal(rightGuess.response.status, 200, JSON.stringify(rightGuess.data));
  assert.equal(rightGuess.data.party.myGuess, guests[0].publicId);
  const wrongGuess = await action(db, { action: "guess", code: room.code, participantId: guests[2].id, guessParticipantId: guests[3].publicId });
  assert.equal(wrongGuess.response.status, 200, JSON.stringify(wrongGuess.data));
  const guesserBefore = db.first("SELECT score FROM participants WHERE id = ?", guests[1].id).score;

  // Flair: allowlisted only, visible to the host after the cursor.
  const badFlair = await action(db, { action: "flair", code: room.code, participantId: guests[2].id, emoji: "🦄" });
  assert.equal(badFlair.response.status, 400);
  const flair = await action(db, { action: "flair", code: room.code, participantId: guests[2].id, emoji: "🔥" });
  assert.equal(flair.response.status, 200, JSON.stringify(flair.data));
  const hostAfterFlair = await (await requestWorker(`/api/party?code=${room.code}&activityAfter=`, { headers: { "x-hackmusic-participant": room.participantId, "x-hackmusic-host-key": room.hostKey, "cf-connecting-ip": "203.0.113.103" } }, { DB: db })).json();
  assert.equal(hostAfterFlair.party.flair.length, 1);
  assert.equal(hostAfterFlair.party.flair[0].emoji, "🔥");

  // Double cheer: +6 once, then spent.
  const boosted = await action(db, { action: "react", code: room.code, participantId: guests[3].id, kind: "up", boost: true }, { "cf-connecting-ip": "203.0.113.110" });
  assert.equal(boosted.response.status, 200, JSON.stringify(boosted.data));
  assert.equal(boosted.data.boosted, true);
  assert.equal(boosted.data.party.powerUps.boostAvailable, false);
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", guests[0].id).score, before + 6);
  assert.equal(boosted.data.party.reactions.find((reaction) => reaction.mine).boosted, true);

  // Boos on a shielded song: first is absorbed (0 points), skip only at the fourth boo.
  const boo1 = await action(db, { action: "react", code: room.code, participantId: guests[1].id, kind: "down" }, { "cf-connecting-ip": "203.0.113.111" });
  assert.equal(boo1.response.status, 200, JSON.stringify(boo1.data));
  assert.equal(boo1.data.shieldAbsorbed, true);
  assert.equal(boo1.data.skipped, false);
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", guests[0].id).score, before + 6);
  const boo2 = await action(db, { action: "react", code: room.code, participantId: guests[2].id, kind: "down" }, { "cf-connecting-ip": "203.0.113.112" });
  assert.equal(boo2.data.skipped, false);
  assert.equal(boo2.data.shieldAbsorbed, false);
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", guests[0].id).score, before + 3);
  const hostBoo = await action(db, { action: "react", code: room.code, participantId: room.participantId, kind: "down" }, { "cf-connecting-ip": "203.0.113.113" });
  assert.equal(hostBoo.response.status, 200, JSON.stringify(hostBoo.data));
  assert.equal(hostBoo.data.skipped, false, "three boos must not skip a shielded song");
  assert.equal(db.first("SELECT status FROM submissions WHERE id = ?", songId).status, "playing");

  // The host skips it; guesses resolve and the correct guesser gets +2, exactly once.
  const skipped = await action(db, { action: "skip", code: room.code, participantId: room.participantId, pin: room.hostKey });
  assert.equal(skipped.response.status, 200, JSON.stringify(skipped.data));
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", guests[1].id).score, guesserBefore + 2);
  assert.equal(db.first("SELECT correct FROM song_guesses WHERE submission_id = ? AND participant_id = ?", songId, guests[2].id).correct, 0);
  const hidden = await guestView(guests[1].id);
  assert.equal(hidden.lastSong.title, "Shielded Anthem");
  assert.equal(hidden.lastSong.submittedBy, null, "pickers stay secret by default");
  assert.equal(hidden.lastSong.submitterAvatar, null);
  assert.equal(hidden.lastSong.myGuessCorrect, true, "guess results are scored even while names stay hidden");
  assert.equal(hidden.revealPickers, false);
  const hostReveal = await (await requestWorker(`/api/party?code=${room.code}`, { headers: { "x-hackmusic-participant": room.participantId, "x-hackmusic-host-key": room.hostKey, "cf-connecting-ip": "203.0.113.104" } }, { DB: db })).json();
  assert.equal(hostReveal.party.lastSong.submittedBy, "Fan One", "the host always sees pickers");
  const guestToggle = await action(db, { action: "revealPickers", code: room.code, participantId: guests[0].id, pin: "nope", revealPickers: true });
  assert.equal(guestToggle.response.status, 403);
  const revealOn = await action(db, { action: "revealPickers", code: room.code, participantId: room.participantId, pin: room.hostKey, revealPickers: true });
  assert.equal(revealOn.response.status, 200, JSON.stringify(revealOn.data));
  assert.equal(revealOn.data.party.revealPickers, true);
  const reveal = await guestView(guests[1].id);
  assert.equal(reveal.lastSong.title, "Shielded Anthem");
  assert.equal(reveal.lastSong.submittedBy, "Fan One");
  assert.equal(reveal.lastSong.totalGuesses, 2);
  assert.equal(reveal.lastSong.correctGuesses, 1);
  assert.equal(reveal.lastSong.myGuessCorrect, true);
  assert.equal((await guestView(guests[0].id)).lastSong.mine, true);
  const lateGuess = await action(db, { action: "guess", code: room.code, participantId: guests[2].id, guessParticipantId: guests[1].publicId });
  assert.equal(lateGuess.response.status, 200);
  assert.equal(db.first("SELECT correct FROM song_guesses WHERE submission_id = ? AND participant_id = ?", songId, guests[2].id).correct, 0, "resolved guesses stay resolved");

  // Ending reveals awards to everyone.
  const ended = await action(db, { action: "end", code: room.code, participantId: room.participantId, pin: room.hostKey });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  const awardIds = ended.data.party.awards.map((entry) => entry.id);
  assert.ok(awardIds.includes("crowd-pleaser"), awardIds.join(","));
  assert.ok(awardIds.includes("most-booed"));
  assert.ok(awardIds.includes("sharpest-guesser"));
  assert.equal(ended.data.party.awards.find((entry) => entry.id === "sharpest-guesser").winnerName, "Fan Two");
  const guestEnd = await guestView(guests[1].id);
  assert.equal(guestEnd.awards.find((entry) => entry.id === "sharpest-guesser").winnerName, "You");
  assert.equal(guestEnd.theme, "Guilty pleasures");
  assert.ok(hostPublicId);
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

test("a targeted one-use handoff rotates the host key and retires the previous browser", async () => {
  const room = await createRoom(db, { title: "Host Handoff Party" });
  const chosen = await joinRoom(db, room, "Chosen Human");
  const bystander = await joinRoom(db, room, "Suspicious Bystander");
  assert.equal(chosen.response.status, 200, JSON.stringify(chosen.data));
  assert.equal(bystander.response.status, 200, JSON.stringify(bystander.data));

  const prepared = await action(db, {
    action: "prepareHostTransfer",
    code: room.code,
    participantId: room.participantId,
    pin: room.hostKey,
    targetParticipantId: chosen.data.party.viewer.id,
  });
  assert.equal(prepared.response.status, 200, JSON.stringify(prepared.data));
  assert.equal(prepared.data.transfer.targetName, "Chosen Human");
  assert.match(prepared.data.transfer.token, /^[A-Za-z0-9_-]{43}$/);

  const stolen = await action(db, {
    action: "claimHost",
    code: room.code,
    participantId: bystander.participantId,
    transferToken: prepared.data.transfer.token,
  });
  assert.equal(stolen.response.status, 401);
  assert.match(stolen.data.error, /another human/i);

  const claimed = await action(db, {
    action: "claimHost",
    code: room.code,
    participantId: chosen.participantId,
    transferToken: prepared.data.transfer.token,
  });
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.data));
  assert.notEqual(claimed.data.hostKey, room.hostKey);
  assert.equal(claimed.data.party.viewer.name, "You");
  assert.ok(Array.isArray(claimed.data.party.queuedTracks));

  const retired = await action(db, { action: "queueMode", code: room.code, participantId: room.participantId, pin: room.hostKey, queueMode: "random" });
  assert.equal(retired.response.status, 403);
  assert.match(retired.data.error, /current host browser|belong/i);

  const reused = await action(db, {
    action: "claimHost",
    code: room.code,
    participantId: chosen.participantId,
    transferToken: prepared.data.transfer.token,
  });
  assert.equal(reused.response.status, 401);
  assert.match(reused.data.error, /already used/i);

  const newHostControl = await action(db, { action: "queueMode", code: room.code, participantId: chosen.participantId, pin: claimed.data.hostKey, queueMode: "fair" });
  assert.equal(newHostControl.response.status, 200, JSON.stringify(newHostControl.data));
  assert.equal(newHostControl.data.party.queueMode, "fair");
});

test("only the active host can rename a live event", async () => {
  const room = await createRoom(db, { title: "Name Pending Party" });

  const rejected = await action(db, { action: "rename", code: room.code, participantId: room.participantId, pin: "wrong-host-key", title: "Stolen Party Name" });
  assert.equal(rejected.response.status, 403);
  assert.equal(db.first("SELECT title FROM events WHERE code = ?", room.code).title, "Name Pending Party");

  const invalid = await action(db, { action: "rename", code: room.code, participantId: room.participantId, pin: room.hostKey, title: "No" });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /between 3 and 60/i);

  const renamed = await action(db, { action: "rename", code: room.code, participantId: room.participantId, pin: room.hostKey, title: "  Freshly Scrambled Party  " });
  assert.equal(renamed.response.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.party.title, "Freshly Scrambled Party");
  assert.equal(db.first("SELECT title FROM events WHERE code = ?", room.code).title, "Freshly Scrambled Party");
  assert.equal(renamed.data.party.code, room.code);

  const ended = await action(db, { action: "end", code: room.code, participantId: room.participantId, pin: room.hostKey });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  const frozen = await action(db, { action: "rename", code: room.code, participantId: room.participantId, pin: room.hostKey, title: "Too Late Party" });
  assert.equal(frozen.response.status, 400);
  assert.match(frozen.data.error, /name is frozen/i);
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

test("simultaneous cheers and boos from many guests are all recorded and never skip early", async () => {
  const created = await action(db, { action: "create", title: "Burst Party", name: "Host Human", passcode: "VIBE42" }, { "cf-connecting-ip": "203.0.113.120" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const room = created.data.room;
  const guests = [];
  for (const name of ["Burst A", "Burst B", "Burst C", "Burst D", "Burst E"]) {
    const joined = await joinRoom(db, room, name);
    assert.equal(joined.response.status, 200, JSON.stringify(joined.data));
    guests.push(joined.participantId);
  }
  const songId = seedTrack(db, room, room.participantId, { duration: "3:00", title: "Burst Song" });
  seedTrack(db, room, guests[0], { status: "pending", uri: `spotify:track:${"E".repeat(22)}`, title: "After The Burst" });

  // Two boos and three cheers fired at the same moment.
  const results = await Promise.all([
    action(db, { action: "react", code: room.code, participantId: guests[0], kind: "down" }, { "cf-connecting-ip": "203.0.113.121" }),
    action(db, { action: "react", code: room.code, participantId: guests[1], kind: "down" }, { "cf-connecting-ip": "203.0.113.122" }),
    action(db, { action: "react", code: room.code, participantId: guests[2], kind: "up" }, { "cf-connecting-ip": "203.0.113.123" }),
    action(db, { action: "react", code: room.code, participantId: guests[3], kind: "up" }, { "cf-connecting-ip": "203.0.113.124" }),
    action(db, { action: "react", code: room.code, participantId: guests[4], kind: "up" }, { "cf-connecting-ip": "203.0.113.125" }),
  ]);
  for (const result of results) assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(results.every((result) => result.data.skipped === false), true, "two boos must never skip");
  assert.equal(db.first("SELECT status FROM submissions WHERE id = ?", songId).status, "playing");
  assert.equal(db.first("SELECT COUNT(*) AS count FROM reactions WHERE submission_id = ?", songId).count, 5);
  assert.equal(db.first("SELECT score FROM participants WHERE id = ?", room.participantId).score, 30 + 9 - 6);

  const hostView = await (await requestWorker(`/api/party?code=${room.code}&activityAfter=`, { headers: { "x-hackmusic-participant": room.participantId, "x-hackmusic-host-key": room.hostKey, "cf-connecting-ip": "203.0.113.126" } }, { DB: db })).json();
  assert.equal(hostView.party.currentTrack.title, "Burst Song");
  assert.deepEqual(hostView.party.activity.map((item) => item.tone).sort(), ["down", "down", "song", "up", "up", "up"]);
});


test("development hosts get 25x rate-limit headroom so a shared-IP test lab never trips 429s, production does not", async () => {
  const created = await action(db, { action: "create", title: "Limit Lab", name: "Host Human", passcode: "VIBE42" }, { "cf-connecting-ip": "203.0.113.130" });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const guest = await joinRoom(db, created.data.room, "Paste Machine");
  assert.equal(guest.response.status, 200, JSON.stringify(guest.data));
  // Ten rapid submissions from one guest on localhost: the production cap is six per minute.
  for (let index = 0; index < 10; index += 1) {
    const result = await action(db, { action: "submit", code: created.data.room.code, participantId: guest.participantId, trackUrl: "https://soundcloud.com/x/y" }, { "cf-connecting-ip": "203.0.113.131" });
    assert.equal(result.response.status, 400, `submission ${index + 1}: ${JSON.stringify(result.data)}`);
  }
  // Production host: the sixth room creation from one network within the window is refused.
  const statuses = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await requestWorker("https://hackmusic.fun/api/party", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://hackmusic.fun", "cf-connecting-ip": "198.51.100.77" },
      body: JSON.stringify({ action: "create", title: `Prod Room ${index}`, name: "Host Human", passcode: "VIBE42" }),
    }, { DB: db });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
});
