import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

let partySchemaPromise: Promise<void> | null = null;

async function initializePartySchema() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'live',
      scheduled_for TEXT,
      queue_mode TEXT NOT NULL DEFAULT 'ordered',
      current_submission_id TEXT,
      host_pin TEXT NOT NULL,
      join_passcode_hash TEXT,
      join_passcode_salt TEXT,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      public_id TEXT UNIQUE,
      event_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      initials TEXT NOT NULL,
      color TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      provider_track_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration TEXT NOT NULL,
      color TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      skip_reason TEXT,
      skip_percent INTEGER,
      submitted_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS activity_events (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      participant_id TEXT,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS host_transfers (
      event_id TEXT PRIMARY KEY,
      target_participant_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS room_creation_limits (
      client_key TEXT NOT NULL,
      window_kind TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (client_key, window_kind, window_start)
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS analytics_pageviews (
      id TEXT PRIMARY KEY,
      visited_at TEXT NOT NULL,
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      visit_hash TEXT NOT NULL,
      referrer_host TEXT NOT NULL,
      device TEXT NOT NULL,
      country TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS submissions_event_track_unique ON submissions(event_id, provider_track_id)"),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS reactions_submission_participant_unique ON reactions(submission_id, participant_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS participants_event_idx ON participants(event_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS submissions_event_participant_status_idx ON submissions(event_id, participant_id, status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS activity_events_event_created_idx ON activity_events(event_id, created_at, id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS host_transfers_expires_idx ON host_transfers(expires_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS room_creation_limits_expires_idx ON room_creation_limits(expires_at)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS analytics_pageviews_day_idx ON analytics_pageviews(day)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS analytics_pageviews_day_path_idx ON analytics_pageviews(day, path)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS analytics_pageviews_day_visit_idx ON analytics_pageviews(day, visit_hash)"),
  ]);
  const eventColumns = await d1.prepare("PRAGMA table_info(events)").all<{ name: string }>();
  const existingEventColumns = new Set(eventColumns.results.map((column) => column.name));
  const missingEventColumns = [
    ["queue_mode", "ALTER TABLE events ADD COLUMN queue_mode TEXT NOT NULL DEFAULT 'ordered'"],
    ["scheduled_for", "ALTER TABLE events ADD COLUMN scheduled_for TEXT"],
    ["join_passcode_hash", "ALTER TABLE events ADD COLUMN join_passcode_hash TEXT"],
    ["join_passcode_salt", "ALTER TABLE events ADD COLUMN join_passcode_salt TEXT"],
  ] as const;
  for (const [column, statement] of missingEventColumns) {
    if (existingEventColumns.has(column)) continue;
    try {
      await d1.prepare(statement).run();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column")) throw error;
    }
  }
  const participantColumns = await d1.prepare("PRAGMA table_info(participants)").all<{ name: string }>();
  if (!participantColumns.results.some((column) => column.name === "public_id")) {
    try { await d1.prepare("ALTER TABLE participants ADD COLUMN public_id TEXT").run(); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("duplicate column")) throw error; }
  }
  await d1.prepare("UPDATE participants SET public_id = 'person-' || lower(hex(randomblob(12))) WHERE public_id IS NULL").run();
  const submissionColumns = await d1.prepare("PRAGMA table_info(submissions)").all<{ name: string }>();
  const existingSubmissionColumns = new Set(submissionColumns.results.map((column) => column.name));
  const missingSubmissionColumns = [
    ["skip_reason", "ALTER TABLE submissions ADD COLUMN skip_reason TEXT"],
    ["skip_percent", "ALTER TABLE submissions ADD COLUMN skip_percent INTEGER"],
  ] as const;
  for (const [column, statement] of missingSubmissionColumns) {
    if (existingSubmissionColumns.has(column)) continue;
    try {
      await d1.prepare(statement).run();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column")) throw error;
    }
  }
  await d1.batch([
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS participants_public_id_unique ON participants(public_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS participants_event_idx ON participants(event_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS submissions_event_participant_status_idx ON submissions(event_id, participant_id, status)"),
    d1.prepare("PRAGMA optimize"),
  ]);
}

export function ensurePartySchema() {
  if (!partySchemaPromise) {
    partySchemaPromise = initializePartySchema().catch((error) => {
      partySchemaPromise = null;
      throw error;
    });
  }
  return partySchemaPromise;
}
