CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`current_submission_id` text,
	`host_pin` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_code_unique` ON `events` (`code`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`display_name` text NOT NULL,
	`initials` text NOT NULL,
	`color` text NOT NULL,
	`score` integer DEFAULT 30 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_submission_participant_unique` ON `reactions` (`submission_id`,`participant_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`provider_track_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`duration` text NOT NULL,
	`color` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_event_track_unique` ON `submissions` (`event_id`,`provider_track_id`);