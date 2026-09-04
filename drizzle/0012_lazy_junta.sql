CREATE TABLE `device_moves` (
	`participant_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`includes_host` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_moves_token_hash_unique` ON `device_moves` (`token_hash`);--> statement-breakpoint
CREATE INDEX `device_moves_expires_idx` ON `device_moves` (`expires_at`);