import { ensurePartySchema, getD1 } from ".";

export const BACKUP_FORMAT = "hackmusic-portable-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const DATABASE_SCHEMA_VERSION = 1;

type BackupRows = Record<string, unknown>[];

async function allRows(sql: string): Promise<BackupRows> {
  const result = await getD1().prepare(sql).all<Record<string, unknown>>();
  return result.results;
}

export async function readPortableBackup() {
  await ensurePartySchema();

  const [events, participants, submissions, reactions, activityEvents, flairEvents, songGuesses, analyticsPageviews] = await Promise.all([
    allRows(`SELECT id, code, title, status, scheduled_for, queue_mode, music_source, theme, current_submission_id,
      host_pin, join_passcode_hash, join_passcode_salt, created_at
      FROM events ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, public_id, event_id, display_name, initials, color, score, shield_used, boost_used, created_at
      FROM participants ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, event_id, participant_id, provider_track_id, title, artist, duration,
      color, status, skip_reason, skip_percent, shielded, shield_absorbed, submitted_at
      FROM submissions ORDER BY submitted_at ASC, id ASC`),
    allRows(`SELECT id, event_id, submission_id, participant_id, kind, weight, created_at
      FROM reactions ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, event_id, submission_id, participant_id, kind, created_at
      FROM activity_events ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, event_id, submission_id, participant_id, emoji, created_at
      FROM flair_events ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, event_id, submission_id, participant_id, guessed_participant_id, correct, created_at
      FROM song_guesses ORDER BY created_at ASC, id ASC`),
    allRows(`SELECT id, visited_at, day, path, visit_hash, referrer_host, device, country
      FROM analytics_pageviews ORDER BY visited_at ASC, id ASC`),
  ]);

  const tables = {
    events,
    participants,
    submissions,
    reactions,
    activity_events: activityEvents,
    flair_events: flairEvents,
    song_guesses: songGuesses,
    analytics_pageviews: analyticsPageviews,
  };

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    databaseSchemaVersion: DATABASE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      product: "HackMusic",
      canonicalSite: "https://hackmusic.fun",
      database: "OpenAI Sites D1",
    },
    privacy: {
      containsSecrets: true,
      note: "Contains room host keys, hashed join passcodes, participant data, and party history. Keep the encrypted file and passphrase private.",
      excludedTables: ["room_creation_limits", "host_transfers"],
    },
    counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    tables,
  };
}

export type PortableBackup = Awaited<ReturnType<typeof readPortableBackup>>;
