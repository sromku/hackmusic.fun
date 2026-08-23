import { ensurePartySchema, getD1 } from ".";
import { PublicError } from "../lib/public-error";
import { readAnalyticsOverview } from "./analytics";

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
  scheduled_for: string | null;
  queue_mode: string;
  created_at: string;
  current_track: string | null;
  participants: number;
  tracks: number;
  reactions: number;
};

type PartyPulseRow = {
  day: string;
  rooms: number;
  humans: number;
  tracks: number;
  song_starts: number;
  cheers: number;
  boos: number;
  reactions: number;
  active_rooms: number;
  period_active_rooms: number;
};

function roomCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export async function readAdminOverview() {
  await ensurePartySchema();
  const d1 = getD1();
  const [totals, rooms, analytics, partyPulseResult] = await Promise.all([
    d1.prepare(`SELECT
      (SELECT COUNT(*) FROM events) AS rooms,
      (SELECT COUNT(*) FROM events WHERE status = 'live') AS live_rooms,
      (SELECT COUNT(*) FROM participants) AS participants,
      (SELECT COUNT(*) FROM submissions) AS tracks,
      (SELECT COUNT(*) FROM reactions) AS reactions`).first<CountRow>(),
    d1.prepare(`SELECT
      e.code, e.title, e.status, e.scheduled_for, e.queue_mode, e.created_at,
      (SELECT s.title FROM submissions s WHERE s.id = e.current_submission_id) AS current_track,
      (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participants,
      (SELECT COUNT(*) FROM submissions s WHERE s.event_id = e.id) AS tracks,
      (SELECT COUNT(*) FROM reactions r WHERE r.event_id = e.id) AS reactions
      FROM events e
      ORDER BY e.created_at DESC
      LIMIT 100`).all<RoomRow>(),
    readAnalyticsOverview(),
    d1.prepare(`WITH RECURSIVE days(day) AS (
      SELECT date('now', '-29 days')
      UNION ALL
      SELECT date(day, '+1 day') FROM days WHERE day < date('now')
    ),
    rooms_by_day AS (
      SELECT date(created_at) AS day, COUNT(*) AS rooms
      FROM events WHERE date(created_at) >= date('now', '-29 days')
      GROUP BY date(created_at)
    ),
    humans_by_day AS (
      SELECT date(created_at) AS day, COUNT(*) AS humans
      FROM participants WHERE date(created_at) >= date('now', '-29 days')
      GROUP BY date(created_at)
    ),
    tracks_by_day AS (
      SELECT date(submitted_at) AS day, COUNT(*) AS tracks
      FROM submissions WHERE date(submitted_at) >= date('now', '-29 days')
      GROUP BY date(submitted_at)
    ),
    starts_by_day AS (
      SELECT date(created_at) AS day, COUNT(*) AS song_starts
      FROM activity_events
      WHERE kind = 'song_start' AND date(created_at) >= date('now', '-29 days')
      GROUP BY date(created_at)
    ),
    reactions_by_day AS (
      SELECT date(created_at) AS day,
        SUM(CASE WHEN kind = 'up' THEN 1 ELSE 0 END) AS cheers,
        SUM(CASE WHEN kind = 'down' THEN 1 ELSE 0 END) AS boos,
        COUNT(*) AS reactions
      FROM reactions WHERE date(created_at) >= date('now', '-29 days')
      GROUP BY date(created_at)
    ),
    room_touches AS (
      SELECT event_id, date(created_at) AS day FROM participants WHERE date(created_at) >= date('now', '-29 days')
      UNION ALL
      SELECT event_id, date(submitted_at) AS day FROM submissions WHERE date(submitted_at) >= date('now', '-29 days')
      UNION ALL
      SELECT event_id, date(created_at) AS day FROM reactions WHERE date(created_at) >= date('now', '-29 days')
      UNION ALL
      SELECT event_id, date(created_at) AS day FROM activity_events WHERE date(created_at) >= date('now', '-29 days')
      UNION ALL
      SELECT id AS event_id, date(created_at) AS day FROM events WHERE date(created_at) >= date('now', '-29 days')
    ),
    active_by_day AS (
      SELECT day, COUNT(DISTINCT event_id) AS active_rooms FROM room_touches GROUP BY day
    ),
    period_active AS (
      SELECT COUNT(DISTINCT event_id) AS active_rooms FROM room_touches
    )
    SELECT days.day,
      COALESCE(rooms_by_day.rooms, 0) AS rooms,
      COALESCE(humans_by_day.humans, 0) AS humans,
      COALESCE(tracks_by_day.tracks, 0) AS tracks,
      COALESCE(starts_by_day.song_starts, 0) AS song_starts,
      COALESCE(reactions_by_day.cheers, 0) AS cheers,
      COALESCE(reactions_by_day.boos, 0) AS boos,
      COALESCE(reactions_by_day.reactions, 0) AS reactions,
      COALESCE(active_by_day.active_rooms, 0) AS active_rooms,
      period_active.active_rooms AS period_active_rooms
    FROM days
    LEFT JOIN rooms_by_day ON rooms_by_day.day = days.day
    LEFT JOIN humans_by_day ON humans_by_day.day = days.day
    LEFT JOIN tracks_by_day ON tracks_by_day.day = days.day
    LEFT JOIN starts_by_day ON starts_by_day.day = days.day
    LEFT JOIN reactions_by_day ON reactions_by_day.day = days.day
    LEFT JOIN active_by_day ON active_by_day.day = days.day
    CROSS JOIN period_active
    ORDER BY days.day ASC`).all<PartyPulseRow>(),
  ]);

  const partyPulseDays = partyPulseResult.results.map((row) => ({
    day: row.day,
    rooms: row.rooms,
    humans: row.humans,
    tracks: row.tracks,
    songStarts: row.song_starts,
    cheers: row.cheers,
    boos: row.boos,
    reactions: row.reactions,
    activeRooms: row.active_rooms,
  }));
  const pulseTotals = partyPulseDays.reduce((sum, row) => ({
    rooms: sum.rooms + row.rooms,
    humans: sum.humans + row.humans,
    tracks: sum.tracks + row.tracks,
    songStarts: sum.songStarts + row.songStarts,
    cheers: sum.cheers + row.cheers,
    boos: sum.boos + row.boos,
    reactions: sum.reactions + row.reactions,
  }), { rooms: 0, humans: 0, tracks: 0, songStarts: 0, cheers: 0, boos: 0, reactions: 0 });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      rooms: totals?.rooms ?? 0,
      liveRooms: totals?.live_rooms ?? 0,
      participants: totals?.participants ?? 0,
      tracks: totals?.tracks ?? 0,
      reactions: totals?.reactions ?? 0,
    },
    analytics,
    partyPulse: {
      periodDays: 30,
      timezone: "UTC",
      startDate: partyPulseDays[0]?.day ?? "",
      endDate: partyPulseDays.at(-1)?.day ?? "",
      totals: {
        ...pulseTotals,
        activeRooms: partyPulseResult.results[0]?.period_active_rooms ?? 0,
      },
      trend: partyPulseDays,
    },
    rooms: rooms.results.map((room) => ({
      code: room.code,
      title: room.title,
      status: room.status,
      scheduledFor: room.scheduled_for,
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
  if (code.length !== 6) throw new PublicError("Use a six-character room code.");

  const room = await d1.prepare(`SELECT code, title, status, scheduled_for, queue_mode, created_at
    FROM events WHERE code = ?`).bind(code).first<{
      code: string; title: string; status: string; scheduled_for: string | null; queue_mode: string; created_at: string;
    }>();
  if (!room) throw new PublicError("Room not found. Check the six-character code and try again.", 404);

  const event = await d1.prepare("SELECT id FROM events WHERE code = ?").bind(code).first<{ id: string }>();
  if (!event) throw new PublicError("Room not found. Check the six-character code and try again.", 404);

  const [participants, submissions, reactions, activity] = await Promise.all([
    d1.prepare(`SELECT display_name, initials, color, score, created_at
      FROM participants WHERE event_id = ? ORDER BY created_at ASC`).bind(event.id).all<{
        display_name: string; initials: string; color: string; score: number; created_at: string;
      }>(),
    d1.prepare(`SELECT s.title, s.artist, s.duration, s.status, s.skip_reason, s.skip_percent, s.submitted_at,
      p.display_name AS submitted_by
      FROM submissions s JOIN participants p ON p.id = s.participant_id
      WHERE s.event_id = ? ORDER BY s.submitted_at DESC LIMIT 1000`).bind(event.id).all<{
        title: string; artist: string; duration: string; status: string; skip_reason: string | null; skip_percent: number | null; submitted_at: string; submitted_by: string;
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
      scheduledFor: room.scheduled_for,
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
      skipReason: track.skip_reason,
      skipPercent: track.skip_percent,
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
