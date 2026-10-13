CREATE TABLE `profile_subscription_sources` (
	`profile_id` text NOT NULL,
	`source_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `source_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_subscription_sources_source_idx` ON `profile_subscription_sources` (`source_id`,`profile_id`);