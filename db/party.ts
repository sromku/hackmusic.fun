import { ensurePartySchema, getD1 } from ".";
import { MAX_PENDING_TRACKS_PER_PERSON } from "../lib/party-rules";
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
};

export type QueueMode = "ordered" | "random" | "fair";

type ParticipantRow = {
  id: string;
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
  return getD1().prepare("SELECT id, code, title, status, scheduled_for, queue_mode, current_submission_id, host_pin FROM events WHERE code = ?")
    .bind(cleanCode(code)).first<EventRow>();
}

export async function createRoom(titleInput: string, hostNameInput: string, options: { preParty?: boolean; scheduledFor?: string } = {}) {
  await ensurePartySchema();
  const title = cleanName(titleInput);
  const hostName = cleanName(hostNameInput);
  if (title.length < 3 || title.length > 60) throw new Error("Use an event name between 3 and 60 characters.");
  if (hostName.length < 2 || hostName.length > 24) throw new Error("Use a host name between 2 and 24 characters.");
  let scheduledFor: string | null = null;
  if (options.preParty) {
    const scheduledDate = new Date(options.scheduledFor ?? "");
    const now = Date.now();
    const latest = now + (90 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= now || scheduledDate.getTime() > latest) {
      throw new Error("Choose a future start time within 90 days.");
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
  if (!code) throw new Error("Could not reserve a room code. Try again.");

  const eventId = `event-${crypto.randomUUID()}`;
  const participantId = `p-${crypto.randomUUID()}`;
  const hostKey = `host-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const profile = profileFor(hostName);
  const now = new Date().toISOString();
  const status = options.preParty ? "lobby" : "live";
  await d1.batch([
    d1.prepare("INSERT INTO events (id, code, title, status, scheduled_for, current_submission_id, host_pin, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)")
      .bind(eventId, code, title, status, scheduledFor, hostKey, now),
    d1.prepare("INSERT INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, 30, ?)")
      .bind(participantId, eventId, hostName, profile.initials, profile.color, now),
  ]);
  return { code, title, participantId, hostKey };
}

export async function readRoomSummary(codeInput: string) {
  const event = await getEvent(codeInput);
  if (!event) throw new Error("Room not found.");
  return { code: event.code, title: event.title, status: event.status, scheduledFor: event.scheduled_for };
}

export async function readParty(codeInput: string, viewerId: string, hostKey = "", activityAfter?: string) {
  const event = await getEvent(codeInput);
  if (!event) throw new Error("Room not found.");
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
    ? "SELECT id, display_name, initials, color, score FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC"
    : "SELECT id, display_name, initials, color, score FROM participants WHERE event_id = ? ORDER BY created_at ASC")
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
    id: person.id,
    initials: person.initials,
    name: person.id === viewerId ? "You" : person.display_name,
    score: revealScores ? person.score : null,
    color: person.color,
  }));
  const viewer = people.find((person) => person.id === viewerId);
  if (!viewer) throw new Error("Join this room first.");

  return {
    code: event.code,
    title: event.title,
    status: event.status,
    scheduledFor: event.scheduled_for,
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
      participantId: reaction.participant_id,
      avatar: "?",
      name: "Someone",
      message: "booed this song",
      icon: "▼",
      tone: "down",
      createdAt: reaction.created_at,
    } : {
      id: reaction.id,
      participantId: reaction.participant_id,
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
      participantId: item.participant_id,
      tone: "down",
      avatar: "?",
      name: "Someone",
      message: "booed",
      icon: "👎",
      trackTitle: item.title,
      createdAt: item.created_at,
    } : {
      id: item.id,
      participantId: item.participant_id,
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
  if (!event || event.host_pin !== hostKey) throw new Error("This phone is not the host for that room.");
  if (event.status === "ended") throw new Error("This party has ended.");
  if (!(["ordered", "random", "fair"] as const).includes(queueMode)) throw new Error("Choose a valid queue mode.");
  await getD1().prepare("UPDATE events SET queue_mode = ? WHERE id = ?").bind(queueMode, event.id).run();
}

export async function reactToCurrent(code: string, participantId: string, kind: "up" | "down") {
  const event = await getEvent(code);
  if (event?.status === "lobby") throw new Error("Reactions unlock when the host starts the party.");
  if (!event?.current_submission_id) throw new Error("Nothing is playing.");
  if (event.status === "ended") throw new Error("This party has ended.");
  const d1 = getD1();
  const current = await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<SubmissionRow>();
  if (!current) throw new Error("Nothing is playing.");
  if (current.participant_id === participantId) throw new Error("You cannot vote on your own song.");
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new Error("Join this room first.");

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
  if (!event) throw new Error("Room not found.");
  if (event.status === "ended") throw new Error("This party has ended.");
  const d1 = getD1();
  const member = await d1.prepare("SELECT id FROM participants WHERE id = ? AND event_id = ?").bind(participantId, event.id).first<{ id: string }>();
  if (!member) throw new Error("Join this room first.");
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, participantId).first<{ count: number }>();
  if ((pending?.count ?? 0) >= MAX_PENDING_TRACKS_PER_PERSON) throw new Error(`You already have ${MAX_PENDING_TRACKS_PER_PERSON} secret picks waiting.`);
  if (!track.title || !track.artist) throw new Error("Choose a valid song.");

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
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new Error("That song is already hiding in the queue.");
    throw error;
  }
}

export async function joinParty(code: string, participantId: string, displayName: string) {
  const event = await getEvent(code);
  if (!event) throw new Error("Room not found.");
  if (event.status === "ended") throw new Error("This party has ended.");
  const name = cleanName(displayName);
  if (name.length < 2 || name.length > 24) throw new Error("Use a name between 2 and 24 characters.");
  if (!/^p-[a-zA-Z0-9-]+$/.test(participantId)) throw new Error("Invalid participant.");
  const profile = profileFor(name);
  await getD1().prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, 30, ?)")
    .bind(participantId, event.id, name, profile.initials, profile.color, new Date().toISOString()).run();
}

export async function hostControl(code: string, hostKey: string, action: "start" | "skip" | "advance" | "end") {
  const event = await getEvent(code);
  if (!event || event.host_pin !== hostKey) throw new Error("This phone is not the host for that room.");
  if (action === "start") {
    if (event.status !== "lobby") throw new Error("This party has already started.");
    await getD1().prepare("UPDATE events SET status = 'live' WHERE id = ?").bind(event.id).run();
    await advanceCurrent(event, "played");
    return;
  }
  if (action === "end") {
    await getD1().prepare("UPDATE events SET status = 'ended' WHERE id = ?").bind(event.id).run();
    return;
  }
  if (event.status === "lobby") throw new Error("Start the party before controlling playback.");
  if (!event.current_submission_id) throw new Error("Nothing is playing yet.");
  await advanceCurrent(event, action === "advance" ? "played" : "skipped");
}
