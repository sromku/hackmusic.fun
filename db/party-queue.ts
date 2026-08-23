import { getD1 } from ".";
import type { EventRow, SubmissionRow } from "./party-model";
import { durationMilliseconds } from "../lib/party-format";

export async function estimateSkipPercent(event: EventRow, current: SubmissionRow) {
  const duration = durationMilliseconds(current.duration);
  if (!duration) return null;
  const start = await getD1().prepare(`SELECT created_at FROM activity_events
    WHERE event_id = ? AND submission_id = ? AND kind = 'song_start'
    ORDER BY created_at DESC LIMIT 1`)
    .bind(event.id, current.id).first<{ created_at: string }>();
  const startedAt = start ? new Date(start.created_at).getTime() : Number.NaN;
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - startedAt) / duration) * 100)));
}

async function selectNextSubmission(event: EventRow) {
  const d1 = getD1();
  if (event.queue_mode === "random") {
    return d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'pending' ORDER BY RANDOM() LIMIT 1")
      .bind(event.id).first<{ id: string }>();
  }
  if (event.queue_mode === "fair") {
    return d1.prepare(`SELECT s.id
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
      .bind(event.id, event.id).first<{ id: string }>();
  }
  return d1.prepare("SELECT id FROM submissions WHERE event_id = ? AND status = 'pending' ORDER BY submitted_at ASC LIMIT 1")
    .bind(event.id).first<{ id: string }>();
}

export async function advanceCurrentTrack(
  event: EventRow,
  finishedStatus: "skipped" | "played",
  skipReason: "boos" | "host" | null = null,
  skipPercent: number | null = null,
) {
  const d1 = getD1();
  const next = await selectNextSubmission(event);
  const statements = [];
  if (event.current_submission_id) {
    statements.push(d1.prepare("UPDATE submissions SET status = ?, skip_reason = ?, skip_percent = ? WHERE id = ?")
      .bind(finishedStatus, finishedStatus === "skipped" ? skipReason : null, finishedStatus === "skipped" ? skipPercent : null, event.current_submission_id));
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
