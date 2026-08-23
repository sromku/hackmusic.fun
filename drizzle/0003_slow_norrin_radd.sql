CREATE TABLE `room_creation_limits` (
	`client_key` text NOT NULL,
	`window_kind` text NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`client_key`, `window_kind`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `room_creation_limits_expires_idx` ON `room_creation_limits` (`expires_at`);
--> statement-breakpoint
PRAGMA optimize;
