import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  status: text("status").notNull().default("live"),
  scheduledFor: text("scheduled_for"),
  queueMode: text("queue_mode").notNull().default("ordered"),
  currentSubmissionId: text("current_submission_id"),
  hostPin: text("host_pin").notNull(),
  joinPasscodeHash: text("join_passcode_hash"),
  joinPasscodeSalt: text("join_passcode_salt"),
  createdAt: text("created_at").notNull(),
});

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  publicId: text("public_id").unique(),
  eventId: text("event_id").notNull(),
  displayName: text("display_name").notNull(),
  initials: text("initials").notNull(),
  color: text("color").notNull(),
  score: integer("score").notNull().default(30),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("participants_event_idx").on(table.eventId),
]);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  participantId: text("participant_id").notNull(),
  providerTrackId: text("provider_track_id").notNull(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  duration: text("duration").notNull(),
  color: text("color").notNull(),
  status: text("status").notNull().default("pending"),
  skipReason: text("skip_reason"),
  skipPercent: integer("skip_percent"),
  submittedAt: text("submitted_at").notNull(),
}, (table) => [
  uniqueIndex("submissions_event_track_unique").on(table.eventId, table.providerTrackId),
  index("submissions_event_participant_status_idx").on(table.eventId, table.participantId, table.status),
]);

export const reactions = sqliteTable("reactions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  submissionId: text("submission_id").notNull(),
  participantId: text("participant_id").notNull(),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("reactions_submission_participant_unique").on(table.submissionId, table.participantId),
]);

export const activityEvents = sqliteTable("activity_events", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  submissionId: text("submission_id").notNull(),
  participantId: text("participant_id"),
  kind: text("kind").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("activity_events_event_created_idx").on(table.eventId, table.createdAt, table.id),
]);

export const hostTransfers = sqliteTable("host_transfers", {
  eventId: text("event_id").primaryKey(),
  targetParticipantId: text("target_participant_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("host_transfers_expires_idx").on(table.expiresAt),
]);

export const roomCreationLimits = sqliteTable("room_creation_limits", {
  clientKey: text("client_key").notNull(),
  windowKind: text("window_kind").notNull(),
  windowStart: integer("window_start").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.clientKey, table.windowKind, table.windowStart] }),
  index("room_creation_limits_expires_idx").on(table.expiresAt),
]);

export const analyticsPageviews = sqliteTable("analytics_pageviews", {
  id: text("id").primaryKey(),
  visitedAt: text("visited_at").notNull(),
  day: text("day").notNull(),
  path: text("path").notNull(),
  visitHash: text("visit_hash").notNull(),
  referrerHost: text("referrer_host").notNull(),
  device: text("device").notNull(),
  country: text("country").notNull(),
}, (table) => [
  index("analytics_pageviews_day_idx").on(table.day),
  index("analytics_pageviews_day_path_idx").on(table.day, table.path),
  index("analytics_pageviews_day_visit_idx").on(table.day, table.visitHash),
]);
