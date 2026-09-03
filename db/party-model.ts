import { ensurePartySchema, getD1 } from ".";
import type { MusicSource, QueueMode } from "../lib/party-contract";

export type { QueueMode } from "../lib/party-contract";

export type EventRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  scheduled_for: string | null;
  queue_mode: QueueMode;
  music_source: MusicSource;
  theme: string | null;
  current_submission_id: string | null;
  host_pin: string;
  join_passcode_hash: string | null;
  join_passcode_salt: string | null;
  created_at: string;
};

export type ParticipantRow = {
  id: string;
  public_id: string;
  display_name: string;
  initials: string;
  color: string;
  score: number;
  shield_used?: number;
  boost_used?: number;
};

export type SubmissionRow = {
  id: string;
  participant_id: string;
  provider_track_id: string;
  title: string;
  artist: string;
  duration: string;
  color: string;
  shielded?: number;
  shield_absorbed?: number;
};

export type QueuedSubmissionRow = SubmissionRow & {
  display_name: string;
  initials: string;
  submitted_at: string;
};

export type MySubmissionRow = SubmissionRow & {
  status: "pending" | "playing" | "played" | "skipped" | "removed";
  skip_reason: "boos" | "host" | null;
  skip_percent: number | null;
  submitted_at: string;
};

export type SongHistoryRow = MySubmissionRow & {
  display_name: string;
  initials: string;
  started_at: string | null;
};

export type MyReactionHistoryRow = {
  id: string;
  kind: "up" | "down";
  created_at: string;
  provider_track_id: string;
  title: string;
  artist: string;
  status: "pending" | "playing" | "played" | "skipped";
  skip_reason: "boos" | "host" | null;
  skip_percent: number | null;
};

export type ReactionRow = {
  id: string;
  participant_id: string;
  kind: string;
  weight?: number;
  created_at: string;
  display_name: string;
  initials: string;
};

export type ActivityRow = {
  id: string;
  submission_id: string;
  participant_id: string | null;
  kind: string;
  created_at: string;
  display_name: string | null;
  initials: string | null;
  title: string;
};

const roomAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const profileColors = ["sun", "coral", "blue", "mint"];

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function profileForName(name: string) {
  const initials = name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const color = profileColors[[...name].reduce((total, character) => total + character.charCodeAt(0), 0) % profileColors.length];
  return { initials, color };
}

export function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => roomAlphabet[byte % roomAlphabet.length]).join("");
}

export function collapseLegacyReactionActivity(rows: ActivityRow[]) {
  const songStarts: ActivityRow[] = [];
  const latestReaction = new Map<string, ActivityRow>();
  for (const row of rows) {
    if (row.kind === "song_start") songStarts.push(row);
    else latestReaction.set(`${row.submission_id}|${row.participant_id ?? "anonymous"}`, row);
  }
  return [...songStarts, ...latestReaction.values()].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
}

export async function loadEvent(code: string) {
  await ensurePartySchema();
  return getD1().prepare(`SELECT id, code, title, status, scheduled_for, queue_mode, music_source, theme,
      current_submission_id, host_pin, join_passcode_hash, join_passcode_salt, created_at
    FROM events WHERE code = ?`)
    .bind(normalizeRoomCode(code)).first<EventRow>();
}
