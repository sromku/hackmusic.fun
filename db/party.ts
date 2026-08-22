import { ensurePartySchema, getD1 } from ".";

const eventId = "event-lime-42";

type TrackInput = {
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
  current_submission_id: string | null;
  host_pin: string;
};

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

type ReactionRow = {
  id: string;
  participant_id: string;
  kind: string;
  created_at: string;
  display_name: string;
  initials: string;
};

async function seedDemoParty() {
  await ensurePartySchema();
  const d1 = getD1();
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO events (id, code, title, status, current_submission_id, host_pin, created_at) VALUES (?, ?, ?, 'live', ?, ?, ?)")
      .bind(eventId, "LIME-42", "Hackathon Afterdark", "s-current", "4242", now),
    d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("p-you", eventId, "You", "YO", "sun", 30, now),
    d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("p-nora", eventId, "Nora", "NA", "coral", 39, now),
    d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("p-omar", eventId, "Omar", "OM", "blue", 33, now),
    d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("p-mika", eventId, "Mika", "MI", "mint", 27, now),
    d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("p-lena", eventId, "Lena", "LE", "sun", 33, now),
    d1.prepare("INSERT OR IGNORE INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'playing', ?)")
      .bind("s-current", eventId, "p-lena", "spotify-current", "The Less I Know The Better", "Tame Impala", "3:36", "coral", now),
    d1.prepare("INSERT OR IGNORE INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .bind("s-next", eventId, "p-nora", "spotify-next", "Midnight City", "M83", "4:03", "blue", new Date(Date.now() + 1).toISOString()),
    d1.prepare("INSERT OR IGNORE INTO reactions (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("r-nora", eventId, "s-current", "p-nora", "up", now),
    d1.prepare("INSERT OR IGNORE INTO reactions (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("r-mika", eventId, "s-current", "p-mika", "down", new Date(Date.now() + 1).toISOString()),
    d1.prepare("INSERT OR IGNORE INTO reactions (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind("r-omar", eventId, "s-current", "p-omar", "up", new Date(Date.now() + 2).toISOString()),
  ]);
}

export async function readParty(code: string, viewerId: string) {
  await seedDemoParty();
  const d1 = getD1();
  const event = await d1.prepare("SELECT id, code, title, status, current_submission_id, host_pin FROM events WHERE code = ?")
    .bind(code).first<EventRow>();
  if (!event) throw new Error("Party not found.");

  const current = event.current_submission_id
    ? await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color FROM submissions WHERE id = ?")
      .bind(event.current_submission_id).first<SubmissionRow>()
    : null;
  if (!current) throw new Error("This party has no current song.");

  const peopleResult = await d1.prepare("SELECT id, display_name, initials, color, score FROM participants WHERE event_id = ? ORDER BY score DESC, created_at ASC")
    .bind(event.id).all<ParticipantRow>();
  const reactionResult = await d1.prepare(`SELECT r.id, r.participant_id, r.kind, r.created_at, p.display_name, p.initials
      FROM reactions r JOIN participants p ON p.id = r.participant_id
      WHERE r.submission_id = ? ORDER BY r.created_at DESC`)
    .bind(current.id).all<ReactionRow>();
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, viewerId).first<{ count: number }>();

  const people = peopleResult.results.map((person) => ({
    id: person.id,
    initials: person.initials,
    name: person.id === viewerId ? "You" : person.display_name,
    score: person.score,
    color: person.color,
  }));
  const viewer = people.find((person) => person.id === viewerId);
  if (!viewer) throw new Error("Participant not found.");

  return {
    code: event.code,
    title: event.title,
    status: event.status,
    viewer,
    people,
    currentTrack: {
      id: current.provider_track_id,
      title: current.title,
      artist: current.artist,
      duration: current.duration,
      color: current.color,
    },
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
  };
}

async function skipCurrent(event: EventRow) {
  if (!event.current_submission_id) return false;
  const d1 = getD1();
  const next = await d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'pending' ORDER BY submitted_at ASC LIMIT 1")
    .bind(event.id).first<{ id: string }>();
  if (!next) return false;
  await d1.batch([
    d1.prepare("UPDATE submissions SET status = 'skipped' WHERE id = ?").bind(event.current_submission_id),
    d1.prepare("UPDATE submissions SET status = 'playing' WHERE id = ?").bind(next.id),
    d1.prepare("UPDATE events SET current_submission_id = ? WHERE id = ?").bind(next.id, event.id),
  ]);
  return true;
}

export async function reactToCurrent(code: string, participantId: string, kind: "up" | "down") {
  await seedDemoParty();
  const d1 = getD1();
  const event = await d1.prepare("SELECT id, code, title, status, current_submission_id, host_pin FROM events WHERE code = ?")
    .bind(code).first<EventRow>();
  if (!event?.current_submission_id) throw new Error("Nothing is playing.");
  const current = await d1.prepare("SELECT id, participant_id, provider_track_id, title, artist, duration, color FROM submissions WHERE id = ?")
    .bind(event.current_submission_id).first<SubmissionRow>();
  if (!current) throw new Error("Nothing is playing.");
  if (current.participant_id === participantId) throw new Error("You cannot vote on your own song.");

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
    ]);
  } else {
    await d1.batch([
      d1.prepare("INSERT INTO reactions (id, event_id, submission_id, participant_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), event.id, current.id, participantId, kind, now),
      d1.prepare("UPDATE participants SET score = score + ? WHERE id = ?").bind(newEffect, current.participant_id),
    ]);
  }

  const booCount = await d1.prepare("SELECT COUNT(*) AS count FROM reactions WHERE submission_id = ? AND kind = 'down'")
    .bind(current.id).first<{ count: number }>();
  const skipped = (booCount?.count ?? 0) >= 3 ? await skipCurrent(event) : false;
  return { skipped };
}

export async function submitTrack(code: string, participantId: string, track: TrackInput) {
  await seedDemoParty();
  const d1 = getD1();
  const event = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(code).first<{ id: string }>();
  if (!event) throw new Error("Party not found.");
  const pending = await d1.prepare("SELECT COUNT(*) AS count FROM submissions WHERE event_id = ? AND participant_id = ? AND status = 'pending'")
    .bind(event.id, participantId).first<{ count: number }>();
  if ((pending?.count ?? 0) >= 3) throw new Error("You already have three secret picks waiting.");
  if (!track.id || !track.title || !track.artist) throw new Error("Choose a valid song.");

  try {
    await d1.prepare("INSERT INTO submissions (id, event_id, participant_id, provider_track_id, title, artist, duration, color, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .bind(crypto.randomUUID(), event.id, participantId, track.id, track.title.slice(0, 160), track.artist.slice(0, 160), track.duration.slice(0, 12), track.color, new Date().toISOString())
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) throw new Error("That song is already hiding in the queue.");
    throw error;
  }
}

export async function joinParty(code: string, participantId: string, displayName: string) {
  await seedDemoParty();
  const d1 = getD1();
  const event = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(code).first<{ id: string }>();
  if (!event) throw new Error("Party not found.");
  const name = displayName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 24) throw new Error("Use a name between 2 and 24 characters.");
  if (!/^p-[a-zA-Z0-9-]+$/.test(participantId)) throw new Error("Invalid participant.");
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["sun", "coral", "blue", "mint"];
  const color = colors[[...name].reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length];
  await d1.prepare("INSERT OR IGNORE INTO participants (id, event_id, display_name, initials, color, score, created_at) VALUES (?, ?, ?, ?, ?, 30, ?)")
    .bind(participantId, event.id, name, initials, color, new Date().toISOString()).run();
}

export async function hostControl(code: string, pin: string, action: "skip" | "end") {
  await seedDemoParty();
  const d1 = getD1();
  const event = await d1.prepare("SELECT id, code, title, status, current_submission_id, host_pin FROM events WHERE code = ?")
    .bind(code).first<EventRow>();
  if (!event || event.host_pin !== pin) throw new Error("Wrong host PIN.");
  if (action === "end") {
    await d1.prepare("UPDATE events SET status = 'ended' WHERE id = ?").bind(event.id).run();
    return;
  }
  const skipped = await skipCurrent(event);
  if (!skipped) throw new Error("There is no next song yet.");
}
