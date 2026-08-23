ALTER TABLE `events` ADD `join_passcode_hash` text;--> statement-breakpoint
ALTER TABLE `events` ADD `join_passcode_salt` text;--> statement-breakpoint
ALTER TABLE `participants` ADD `public_id` text;--> statement-breakpoint
UPDATE `participants` SET `public_id` = 'person-' || lower(hex(randomblob(12))) WHERE `public_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `participants_public_id_unique` ON `participants` (`public_id`);--> statement-breakpoint
CREATE INDEX `participants_event_idx` ON `participants` (`event_id`);--> statement-breakpoint
CREATE INDEX `submissions_event_participant_status_idx` ON `submissions` (`event_id`,`participant_id`,`status`);--> statement-breakpoint
PRAGMA optimize;
