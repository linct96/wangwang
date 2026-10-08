ALTER TABLE `jobs` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_token` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_until` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `dispatched_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `parent_job_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `source_version` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `refresh_commit_token` text;--> statement-breakpoint
CREATE INDEX `jobs_parent_idx` ON `jobs` (`parent_job_id`);--> statement-breakpoint
CREATE INDEX `jobs_recovery_idx` ON `jobs` (`status`,`lease_until`,`dispatched_at`);--> statement-breakpoint
ALTER TABLE `sources` ADD `version` integer DEFAULT 0 NOT NULL;