CREATE TABLE `node_tags` (
	`node_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`node_id`, `tag_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_tags_tag_idx` ON `node_tags` (`tag_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `profile_tag_filters` (
	`profile_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `tag_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_tag_filters_tag_idx` ON `profile_tag_filters` (`tag_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `source_tags` (
	`source_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`source_id`, `tag_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_tags_tag_idx` ON `source_tags` (`tag_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_idx` ON `tags` (`normalized_name`);