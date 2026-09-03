CREATE TABLE `profile_source_bindings` (
	`profile_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `slot_key`, `source_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_source_bindings_source_profile_idx` ON `profile_source_bindings` (`source_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `profile_source_bindings_profile_slot_idx` ON `profile_source_bindings` (`profile_id`,`slot_key`);--> statement-breakpoint
ALTER TABLE `templates` ADD `migration_status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `migration_error` text;