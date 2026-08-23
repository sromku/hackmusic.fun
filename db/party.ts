import { ensurePartySchema, getD1 } from ".";
import { MAX_PARTICIPANTS_PER_ROOM, MAX_PENDING_TRACKS_PER_PERSON } from "../lib/party-rules";
import { PublicError } from "../lib/public-error";
import { hashRoomPasscode, verifyRoomPasscode } from "../lib/room-passcode";
import { parseSpotifyTrackReference, resolveSpotifyTrack } from "../lib/spotify-track";

export type TrackInput = {
  id: string;
  title: string;
  artist: string;
  duration: string;
  color: string;
};

type EventRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  scheduled_for: string | null;
  queue_mode: QueueMode;
  current_submission_id: string | null;
  host_pin: string;
  join_passcode_hash: string | null;
  join_passcode_salt: string | null;
  created_at: string;
};

export type QueueMode = "ordered" | "random" | "fair";

type ParticipantRow = {
  id: string;
  public_id: string;
  display_name: string;
  initials: string;
  color: string;
  score: number;
};

type SubmissionRow = {
  id: string;
  participant_id: string;
  provider_track_id: string;
  title: string;
  artist: string;
  duration: string;
  color: string;
};

type QueuedSubmissionRow = SubmissionRow & {
  display_name: string;
  initials: string;
  submitted_at: string;
};

type ReactionRow = {
  id: string;
  participant_id: string;
  kind: string;
  created_at: string;
  display_name: string;
  initials: string;
};

type ActivityRow = {
  id: string;
  participant_id: string | null;
  kind: string;
  created_at: string;
  display_name: string | null;
  initials: string | null;
  title: string;
};

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const colors = ["sun", "coral", "blue", "mint"];

function cleanCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function cleanName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function profileFor(name: string) {
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const color = colors[[...name].reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length];
  return { initials, color };
}

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => roomAlphabet[byte % roomAlphabet.length]).join("");
}

async function getEvent(code: string) {
  await ensurePartySchema();
  return getD1().prepare("SELECT id, code, title, status, scheduled_for, queue_mode, current_submission_id, host_pin, join_passcode_hash, join_passcode_salt, created_at FROM events WHERE code = ?")
    .bind(cleanCode(code)).first<EventRow>();
}

export async function createRoom(titleInput: string, hostNameInput: string, options: { passcode?: string; preParty?: boolean; scheduledFor?: string } = {}) {
  await ensurePartySchema();
  const title = cleanName(titleInput);
  const hostName = cleanName(hostNameInput);
  if (title.length < 3 || title.length > 60) throw new PublicError("Use an event name between 3 and 60 characters.");
  if (hostName.length < 2 || hostName.length > 24) throw new PublicError("Use a host name between 2 and 24 characters.");
  let scheduledFor: string | null = null;
  if (options.preParty) {
    const scheduledDate = new Date(options.scheduledFor ?? "");
    const now = Date.now();
    const latest = now + (90 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= now || scheduledDate.getTime() > latest) {
      throw new PublicError("Choose a future start time within 90 days.");
    }
    scheduledFor = scheduledDate.toISOString();
  }

  const d1 = getD1();
  let code = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = randomCode();
    const exists = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(candidate).first<{ id: string }>();
    if (!exists) { code = candidate; break; }
  }
  if (!code) throw new PublicError("We could not reserve a room code. Wait a moment and try again.", 503);

  const eventId = `event-${crypto.randomUUID()}`;
  const participantId = `p-${crypto.randomUUID()}`;
  const hostKey = `host-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const hostPublicId = `person-${crypto.randomUUID()}`;
  const passcode = await hashRoomPasscode(options.passcode ?? "");
  const profile = profileFor(hostName);
  const now = new Date().toISOString();
  const status = options.preParty ? "lobby" : "live";
  await d1.batch([
    d1.prepare("INSERT INTO events (id, code, title, status, scheduled_for, current_submission_id, host_pin, join_passcode_hash, join_passcode_salt, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)")
      .bind(eventId, code, title, status, scheduledFor, hostKey, passcode.hash, passcode.salt, now),
    d1.prepare("INSERT INTO participants (id, public_id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, 30, ?)")
      .bind(participantId, hostPublicId, eventId, hostName, profile.initials, profile.color, now),
  ]);
  return { code, title, status, scheduledFor, createdAt: now, participantId, hostKey };
}

export async function readRoomSummary(codeInput: string) {
  const event = await getEvent(codeInput);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  return { code: event.code, title: event.title, status: event.status, scheduledFor: event.scheduled_for, createdAt: event.created_at, requiresPasscode: Boolean(event.join_passcode_hash) };
}

export async function readParty(codeInput: string, viewerId: string, hostKey = "", activityAfter?: string) {
  const event = await getEvent(codeInput);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  const d1 = getD1();
  const isHost = Boolean(hostKey && hostKey === event.host_pin);
  const revealScores = event.status === "ended" || isHost;
  const current = event.current_submission_id
    ? await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color FROM submissions WHERE id = ?")
      .bind(event.current_submission_id).first<SubmissionRow>()
    : null;

  if (current && (current.artist === "Spotify" || current.artist === "Artist unavailable")) {
    try {
      const enriched = await resolveSpotifyTrack(current.provider_track_id);
      current.title = enriched.title;
      current.artist = enriched.artist;
      current.duration = enriched.duration;
      await d1.prepare("UPDATE submissions SET title = ?, artist = ?, duration = ? WHERE id = ?")
        .bind(enriched.title, enriched.artist, enriched.duration, current.id).run();
    } catch {
      // Keep the stored metadata if Spotify is temporarily unavailable.
    }
  }

  const peopleResult = await d1.prepare(revealScores
    ? "SELECT id, public_id, display_name, initials, color, score FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC"
    : "SELECT id, public_id, display_name, initials, color, score FROM participants WHERE event_id = ? ORDER BY created_at ASC")
    .bind(event.id).all<ParticipantRow>();
  const reactionResult = current
    ? await d1.prepare(`SELECT r.id, r.participant_id, r.kind, r.created_at, p.display_name, p.initials
        FROM reactions r JOIN participants p ON p.id = r.participant_id
        WHERE r.submission_id = ? ORDER BY r.created_at DESC`)
      .bind(current.id).all<ReactionRow>()
    : { results: [] as ReactionRow[] };
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, viewerId).first<{ count: number }>();
  const queue = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND status = 'pending'")
    .bind(event.id).first<{ count: number }>();
  const queuedTracks = isHost
    ? await d1.prepare(`SELECT s.id, s.participant_id, s.provider_track_id, s.title, s.artist, s.duration, s.color, s.submitted_at,
        p.display_name, p.initials
        FROM submissions s JOIN participants p ON p.id = s.participant_id
        WHERE s.event_id = ? AND s.status = 'pending'
        ORDER BY s.submitted_at ASC`)
      .bind(event.id).all<QueuedSubmissionRow>()
    : null;
  let activityResult: { results: ActivityRow[] } | null = null;
  if (activityAfter !== undefined) {
    const separator = activityAfter.lastIndexOf("|");
    const cursorAt = separator > 0 ? activityAfter.slice(0, separator) : "";
    activityResult = cursorAt
      ? await d1.prepare(`SELECT a.id, a.participant_id, a.kind, a.created_at, p.display_name, p.initials, s.title
          FROM activity_events a
          LEFT JOIN participants p ON p.id = a.participant_id
          JOIN submissions s ON s.id = a.submission_id
          WHERE a.event_id = ? AND a.created_at >= ?
          ORDER BY a.created_at ASC, a.id ASC`)
        .bind(event.id, cursorAt).all<ActivityRow>()
      : await d1.prepare(`SELECT a.id, a.participant_id, a.kind, a.created_at, p.display_name, p.initials, s.title
          FROM activity_events a
          LEFT JOIN participants p ON p.id = a.participant_id
          JOIN submissions s ON s.id = a.submission_id
          WHERE a.event_id = ?
          ORDER BY a.created_at ASC, a.id ASC`)
        .bind(event.id).all<ActivityRow>();
  }

  const people = peopleResult.results.map((person) => ({
    id: person.public_id,
    initials: person.initials,
    name: person.id === viewerId ? "You" : person.display_name,
    score: revealScores ? person.score : null,
    color: person.color,
  }));
  const viewerIndex = peopleResult.results.findIndex((person) => person.id === viewerId);
  const viewer = viewerIndex >= 0 ? people[viewerIndex] : undefined;
  if (!viewer) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);

  return {
    code: event.code,
    title: event.title,
    status: event.status,
    scheduledFor: event.scheduled_for,
    requiresPasscode: Boolean(event.join_passcode_hash),
    viewer,
    people,
    currentTrack: current ? {
      id: current.provider_track_id,
      title: current.title,
      artist: current.artist,
      duration: current.duration,
      color: current.color,
    } : null,
    reactions: reactionResult.results.map((reaction) => reaction.kind === "down" ? {
      id: reaction.id,
      mine: reaction.participant_id === viewerId,
      avatar: "?",
      name: "Someone",
      message: "booed this song",
      icon: "▼",
      tone: "down",
      createdAt: reaction.created_at,
    } : {
      id: reaction.id,
      mine: reaction.participant_id === viewerId,
      avatar: reaction.initials,
      name: reaction.participant_id === viewerId ? "You" : reaction.display_name,
      message: "cheered this song",
      icon: "▲",
      tone: "up",
      createdAt: reaction.created_at,
    }),
    pendingCount: pending?.count ?? 0,
    queueCount: queue?.count ?? 0,
    ...(activityResult ? { activity: activityResult.results.map((item) => item.kind === "song_start" ? {
      id: item.id,
      tone: "song",
      avatar: "🎵",
      name: "",
      message: "Now playing",
      icon: "▶️",
      trackTitle: item.title,
      createdAt: item.created_at,
    } : item.kind === "down" ? {
      id: item.id,
      mine: item.participant_id === viewerId,
      tone: "down",
      avatar: "?",
      name: "Someone",
      message: "booed",
      icon: "👎",
      trackTitle: item.title,
      createdAt: item.created_at,
    } : {
      id: item.id,
      mine: item.participant_id === viewerId,
      tone: "up",
      avatar: item.initials ?? "!",
      name: item.participant_id === viewerId ? "You" : item.display_name ?? "Someone",
      message: "cheered",
      icon: "🙌",
      trackTitle: item.title,
      createdAt: item.created_at,
    }) } : {}),
    ...(queuedTracks ? { queueMode: event.queue_mode, queuedTracks: queuedTracks.results.map((track) => ({
      queueId: track.id,
      id: track.provider_track_id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      color: track.color,
      submittedBy: track.participant_id === viewerId ? "You" : track.display_name,
      submitterInitials: track.initials,
    })) } : {}),
  };
}

async function advanceCurrent(event: EventRow, finishedStatus: "skipped" | "played") {
  const d1 = getD1();
  const next = event.queue_mode === "random"
    ? await d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'pending' ORDER BY RANDOM() LIMIT 1")
      .bind(event.id).first<{ id: string }>()
    : event.queue_mode === "fair"
      ? await d1.prepare(`SELECT s.id
          FROM submissions s
          JOIN (
            SELECT participant_id,
              SUM(CASE WHEN status IN ('playing', 'played', 'skipped') THEN 1 ELSE 0 END) AS served_count
            FROM submissions
            WHERE event_id = ?
            GROUP BY participant_id
          ) history ON history.participant_id = s.participant_id
          WHERE s.event_id = ? AND s.status = 'pending'
          ORDER BY history.served_count ASC, RANDOM()
          LIMIT 1`)
        .bind(event.id, event.id).first<{ id: string }>()
      : await d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'pending' ORDER BY submitted_at ASC LIMIT 1")
        .bind(event.id).first<{ id: string }>();
  const statements = [];
  if (event.current_submission_id) {
    statements.push(d1.prepare("UPDATE submissions SET status = ? WHERE id = ?").bind(finishedStatus, event.current_submission_id));
  }
  if (next) {
    statements.push(d1.prepare("UPDATE submissions SET status = 'playing' WHERE id = ?").bind(next.id));
    statements.push(d1.prepare("UPDATE events SET current_submission_id = ? WHERE id = ?").bind(next.id, event.id));
    statements.push(d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, NULL, 'song_start', ?)")
      .bind(`activity-${crypto.randomUUID()}`, event.id, next.id, new Date().toISOString()));
  } else {
    statements.push(d1.prepare("UPDATE events SET current_submission_id = NULL WHERE id = ?").bind(event.id));
  }
  await d1.batch(statements);
  return Boolean(next);
}

export async function setQueueMode(code: string, hostKey: string, queueMode: QueueMode) {
  const event = await getEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its settings are frozen.");
  if (!(["ordered", "random", "fair"] as const).includes(queueMode)) throw new PublicError("Choose one of the available queue modes.");
  await getD1().prepare("UPDATE events SET queue_mode = ? WHERE id = ?").bind(queueMode, event.id).run();
}

export async function setRoomPasscode(code: string, hostKey: string, passcodeInput: string) {
  const event = await getEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (event.status === "ended") throw new PublicError("This party has ended, so its passcode cannot be changed.");
  const passcode = await hashRoomPasscode(passcodeInput);
  await getD1().prepare("UPDATE events SET join_passcode_hash = ?, join_passcode_salt = ? WHERE id = ?")
    .bind(passcode.hash, passcode.salt, event.id).run();
}

export async function reactToCurrent(code: string, participantId: string, kind: "up" | "down") {
  const event = await getEvent(code);
  if (event?.status === "lobby") throw new PublicError("Reactions unlock when the host starts the party.");
  if (!event?.current_submission_id) throw new PublicError("Nothing is playing yet. Wait for the host to start a song.");
  if (event.status === "ended") throw new PublicError("This party has ended, so reactions are closed.");
  const d1 = getD1();
  const current = await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<SubmissionRow>();
  if (!current) throw new PublicError("Nothing is playing yet. Wait for the host to start a song.");
  if (current.participant_id === participantId) throw new PublicError("You cannot vote on your own song—but everyone else still can.");
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);

  const existing = await d1.prepare("SELECT id, kind FROM reactions WHERE submission_id = ? AND participant_id = ?")
    .bind(current.id, participantId).first<{ id: string; kind: string }>();
  if (existing?.kind === kind) return { skipped: false };
  const oldEffect = existing ? (existing.kind === "up" ? 3 : -3) : 0;
  const newEffect = kind === "up" ? 3 : -3;
  const now = new Date().toISOString();
  if (existing) {
    await d1.batch([
      d1.prepare("UPDATE reactions SET kind = ?, created_at = ? WHERE id = ?").bind(kind, now, existing.id),
      d1.prepare("UPDATE participants SET score = score + ? WHERE id = ?").bind(newEffect - oldEffect, current.participant_id),
      d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`activity-${crypto.randomUUID()}`, event.id, current.id, participantId, kind, now),
    ]);
  } else {
    await d1.batch([
      d1.prepare("INSERT INTO reactions (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), event.id, current.id, participantId, kind, now),
      d1.prepare("UPDATE participants SET score = score + ? WHERE id = ?").bind(newEffect, current.participant_id),
      d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(`activity-${crypto.randomUUID()}`, event.id, current.id, participantId, kind, now),
    ]);
  }
  const booCount = await d1.prepare("SELECT COUNT(*) AS count FROM reactions WHERE submission_id = ? AND kind = 'down'")
    .bind(current.id).first<{ count: number }>();
  const skipped = (booCount?.count ?? 0) >= 3;
  if (skipped) await advanceCurrent(event, "skipped");
  return { skipped };
}

export async function submitTrack(code: string, participantId: string, track: TrackInput) {
  const normalizedTrack = parseSpotifyTrackReference(track.id);
  const event = await getEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  if (event.status === "ended") throw new PublicError("This party has ended, so no more songs can be added.");
  const d1 = getD1();
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, participantId).first<{ count: number }>();
  if ((pending?.count ?? 0) >= MAX_PENDING_TRACKS_PER_PERSON) throw new PublicError(`You already have ${MAX_PENDING_TRACKS_PER_PERSON} secret picks waiting. Wait for one to play before adding another.`);
  if (!track.title || !track.artist) throw new PublicError("Spotify did not return enough song information. Copy the track link again.");

  const submissionId = crypto.randomUUID();
  const status = event.status === "lobby" || event.current_submission_id ? "pending" : "playing";
  const now = new Date().toISOString();
  try {
    const statements = [
      d1.prepare("INSERT INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(submissionId, event.id, participantId, normalizedTrack.uri, track.title.slice(0, 160), track.artist.slice(0, 160), track.duration.slice(0, 12), track.color, status, now),
    ];
    if (event.status !== "lobby" && !event.current_submission_id) {
      statements.push(d1.prepare("UPDATE events SET current_submission_id = ? WHERE id = ?").bind(submissionId, event.id));
      statements.push(d1.prepare("INSERT INTO activity_events (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, NULL, 'song_start', ?)")
        .bind(`activity-${crypto.randomUUID()}`, event.id, submissionId, now));
    }
    await d1.batch(statements);
    if (event.status === "lobby") {
      const refreshed = await getEvent(code);
      if (refreshed?.status === "live" && !refreshed.current_submission_id) await advanceCurrent(refreshed, "played");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new PublicError("That song is already hiding in this room’s queue.");
    throw error;
  }
}

export async function assertPartyParticipant(code: string, participantId: string) {
  const event = await getEvent(code);
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);
  const member = await getD1().prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new PublicError("This browser is not joined to the room yet. Reopen the invite and join again.", 401);
}

export async function joinParty(code: string, participantId: string, displayName: string, passcodeInput: string) {
  const event = await getEvent(code);
  if (!event) throw new PublicError("Room not found. Check the room code and passcode, then try again.", 404);
  if (event.status === "ended") throw new PublicError("This party has already ended, so new guests cannot join.");
  if (event.join_passcode_hash && (!event.join_passcode_salt || !await verifyRoomPasscode(passcodeInput, event.join_passcode_hash, event.join_passcode_salt))) throw new PublicError("That room code and passcode do not match. Ask the host for the latest invite.", 401);
  const name = cleanName(displayName);
  if (name.length < 2 || name.length > 24) throw new PublicError("Use a party name between 2 and 24 characters.");
  if (!/^p-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(participantId)) throw new PublicError("We could not prepare this browser to join. Refresh the page and try again.");
  const profile = profileFor(name);
  const publicId = `person-${crypto.randomUUID()}`;
  const result = await getD1().prepare(`INSERT OR IGNORE INTO participants (id, public_id, event_id, display_name, initials, color, score, created_at)
    SELECT ?, ?, ?, ?, ?, ?, 30, ?
    WHERE (SELECT COUNT(*) FROM participants WHERE event_id = ?) < ?`)
    .bind(participantId, publicId, event.id, name, profile.initials, profile.color, new Date().toISOString(), event.id, MAX_PARTICIPANTS_PER_ROOM).run();
  if (!result.meta.changes) throw new PublicError(`This room is full at ${MAX_PARTICIPANTS_PER_ROOM} people. Ask the host to start another room.`);
}

export async function hostControl(code: string, hostKey: string, action: "start" | "skip" | "advance" | "end") {
  const event = await getEvent(code);
  if (!event || event.host_pin !== hostKey) throw new PublicError("Host controls belong to the browser that created this room.", 403);
  if (action === "start") {
    if (event.status !== "lobby") throw new PublicError("This party has already started.");
    await getD1().prepare("UPDATE events SET status = 'live' WHERE id = ?").bind(event.id).run();
    await advanceCurrent(event, "played");
    return;
  }
  if (action === "end") {
    await getD1().prepare("UPDATE events SET status = 'ended' WHERE id = ?").bind(event.id).run();
    return;
  }
  if (event.status === "lobby") throw new PublicError("Start the party before controlling playback.");
  if (!event.current_submission_id) throw new PublicError("Nothing is playing yet. Add a song first.");
  await advanceCurrent(event, action === "advance" ? "played" : "skipped");
}
