CREATE TABLE `analytics_pageviews` (
	`id` text PRIMARY KEY NOT NULL,
	`visited_at` text NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`visit_hash` text NOT NULL,
	`referrer_host` text NOT NULL,
	`device` text NOT NULL,
	`country` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analytics_pageviews_day_idx` ON `analytics_pageviews` (`day`);--> statement-breakpoint
CREATE INDEX `analytics_pageviews_day_path_idx` ON `analytics_pageviews` (`day`,`path`);--> statement-breakpoint
CREATE INDEX `analytics_pageviews_day_visit_idx` ON `analytics_pageviews` (`day`,`visit_hash`);