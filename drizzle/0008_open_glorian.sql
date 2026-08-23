CREATE TABLE `host_transfers` (
	`event_id` text PRIMARY KEY NOT NULL,
	`target_participant_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_transfers_token_hash_unique` ON `host_transfers` (`token_hash`);--> statement-breakpoint
CREATE INDEX `host_transfers_expires_idx` ON `host_transfers` (`expires_at`);