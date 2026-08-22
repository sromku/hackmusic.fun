CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`participant_id` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_events_event_created_idx` ON `activity_events` (`event_id`,`created_at`,`id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `activity_events` (`id`, `event_id`, `submission_id`, `participant_id`, `kind`, `created_at`)
SELECT 'legacy-song-' || `id`, `event_id`, `id`, NULL, 'song_start', `submitted_at`
FROM `submissions`
WHERE `status` != 'pending';
--> statement-breakpoint
INSERT OR IGNORE INTO `activity_events` (`id`, `event_id`, `submission_id`, `participant_id`, `kind`, `created_at`)
SELECT 'legacy-reaction-' || `id`, `event_id`, `submission_id`, `participant_id`, `kind`, `created_at`
FROM `reactions`;
