CREATE TABLE `flair_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`submission_id` text,
	`participant_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `flair_events_event_created_idx` ON `flair_events` (`event_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `song_guesses` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`guessed_participant_id` text NOT NULL,
	`correct` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `song_guesses_submission_participant_unique` ON `song_guesses` (`submission_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `song_guesses_event_idx` ON `song_guesses` (`event_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `theme` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `shield_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `boost_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reactions` ADD `weight` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `shielded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `shield_absorbed` integer DEFAULT 0 NOT NULL;