import { ensurePartySchema, getD1 } from ".";

type CountRow = {
  rooms: number;
  live_rooms: number;
  participants: number;
  tracks: number;
  reactions: number;
};

type RoomRow = {
  code: string;
  title: string;
  status: string;
  queue_mode: string;
  created_at: string;
  current_track: string | null;
  participants: number;
  tracks: number;
  reactions: number;
};

function roomCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export async function readAdminOverview() {
  await ensurePartySchema();
  const d1 = getD1();
  const totals = await d1.prepare(`SELECT
    (SELECT COUNT(*) FROM events) AS rooms,
    (SELECT COUNT(*) FROM events WHERE status = 'live') AS live_rooms,
    (SELECT COUNT(*) FROM participants) AS participants,
    (SELECT COUNT(*) FROM submissions) AS tracks,
    (SELECT COUNT(*) FROM reactions) AS reactions`).first<CountRow>();
  const rooms = await d1.prepare(`SELECT
    e.code, e.title, e.status, e.queue_mode, e.created_at,
    (SELECT s.title FROM submissions s WHERE s.id = e.current_submission_id) AS current_track,
    (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participants,
    (SELECT COUNT(*) FROM submissions s WHERE s.event_id = e.id) AS tracks,
    (SELECT COUNT(*) FROM reactions r WHERE r.event_id = e.id) AS reactions
    FROM events e
    ORDER BY e.created_at DESC
    LIMIT 100`).all<RoomRow>();

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      rooms: totals?.rooms ?? 0,
      liveRooms: totals?.live_rooms ?? 0,
      participants: totals?.participants ?? 0,
      tracks: totals?.tracks ?? 0,
      reactions: totals?.reactions ?? 0,
    },
    rooms: rooms.results.map((room) => ({
      code: room.code,
      title: room.title,
      status: room.status,
      queueMode: room.queue_mode,
      createdAt: room.created_at,
      currentTrack: room.current_track,
      participants: room.participants,
      tracks: room.tracks,
      reactions: room.reactions,
    })),
  };
}

export async function readAdminRoom(codeInput: string) {
  await ensurePartySchema();
  const d1 = getD1();
  const code = roomCode(codeInput);
  if (code.length !== 6) throw new Error("Use a six-character room code.");

  const room = await d1.prepare(`SELECT code, title, status, queue_mode, created_at
    FROM events WHERE code = ?`).bind(code).first<{
      code: string; title: string; status: string; queue_mode: string; created_at: string;
    }>();
  if (!room) throw new Error("Room not found.");

  const event = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(code).first<{ id: string }>();
  if (!event) throw new Error("Room not found.");

  const [participants, submissions, reactions, activity] = await Promise.all([
    d1.prepare(`SELECT display_name, initials, color, score, created_at
      FROM participants WHERE event_id = ? ORDER BY created_at ASC`).bind(event.id).all<{
        display_name: string; initials: string; color: string; score: number; created_at: string;
      }>(),
    d1.prepare(`SELECT s.title, s.artist, s.duration, s.status, s.submitted_at,
      p.display_name AS submitted_by
      FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = ? ORDER BY s.submitted_at DESC LIMIT 1000`).bind(event.id).all<{
        title: string; artist: string; duration: string; status: string; submitted_at: string; submitted_by: string;
      }>(),
    d1.prepare(`SELECT r.kind, r.created_at, p.display_name, s.title
      FROM reactions r
      JOIN participants p ON p.id = r.participant_id
      JOIN submissions s ON s.id = r.submission_id
      WHERE r.event_id = ? ORDER BY r.created_at DESC LIMIT 1000`).bind(event.id).all<{
        kind: string; created_at: string; display_name: string; title: string;
      }>(),
    d1.prepare(`SELECT a.kind, a.created_at, p.display_name, s.title
      FROM activity_events a
      LEFT JOIN participants p ON p.id = a.participant_id
      LEFT JOIN submissions s ON s.id = a.submission_id
      WHERE a.event_id = ? ORDER BY a.created_at DESC, a.id DESC LIMIT 1000`).bind(event.id).all<{
        kind: string; created_at: string; display_name: string | null; title: string | null;
      }>(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    room: {
      code: room.code,
      title: room.title,
      status: room.status,
      queueMode: room.queue_mode,
      createdAt: room.created_at,
    },
    participants: participants.results.map((person) => ({
      name: person.display_name,
      initials: person.initials,
      color: person.color,
      score: person.score,
      joinedAt: person.created_at,
    })),
    submissions: submissions.results.map((track) => ({
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      status: track.status,
      submittedBy: track.submitted_by,
      submittedAt: track.submitted_at,
    })),
    reactions: reactions.results.map((reaction) => ({
      kind: reaction.kind,
      actor: reaction.kind === "up" ? reaction.display_name : "Anonymous boo",
      track: reaction.title,
      createdAt: reaction.created_at,
    })),
    activity: activity.results.map((item) => ({
      kind: item.kind,
      actor: item.kind === "down" ? "Anonymous boo" : item.display_name,
      track: item.title,
      createdAt: item.created_at,
    })),
  };
}
