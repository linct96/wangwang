DROP TABLE `node_entry_tags`;
--> statement-breakpoint
DROP TABLE `source_entries`;
--> statement-breakpoint
DROP TABLE `node_entries`;
--> statement-breakpoint
DROP TABLE `nodes`;
--> statement-breakpoint
CREATE TABLE `physical_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`protocol` text NOT NULL,
	`server` text NOT NULL,
	`port` integer NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `physical_nodes_fingerprint_idx` ON `physical_nodes` (`fingerprint`);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`physical_node_id` text NOT NULL,
	`original_name` text NOT NULL,
	`alias` text,
	`enabled` integer DEFAULT true NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`physical_node_id`) REFERENCES `physical_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nodes_source_position_idx` ON `nodes` (`source_id`,`position`);
--> statement-breakpoint
CREATE INDEX `nodes_physical_idx` ON `nodes` (`physical_node_id`);
--> statement-breakpoint
CREATE TABLE `node_tags` (
	`node_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`node_id`, `tag_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_tags_tag_idx` ON `node_tags` (`tag_id`,`node_id`);
