CREATE TABLE `profile_slot_bindings` (
	`profile_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`mode` text NOT NULL,
	`include_regex` text,
	`exclude_regex` text,
	PRIMARY KEY(`profile_id`, `slot_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_slot_bindings_mode_check" CHECK("profile_slot_bindings"."mode" IN ('source', 'node')),
	CONSTRAINT "profile_slot_bindings_node_regex_check" CHECK("profile_slot_bindings"."mode" = 'source' OR ("profile_slot_bindings"."include_regex" IS NULL AND "profile_slot_bindings"."exclude_regex" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `profile_slot_nodes` (
	`profile_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`node_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `slot_key`, `node_id`),
	FOREIGN KEY (`profile_id`,`slot_key`) REFERENCES `profile_slot_bindings`(`profile_id`,`slot_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_slot_nodes_node_idx` ON `profile_slot_nodes` (`node_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `profile_slot_sources` (
	`profile_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `slot_key`, `source_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`,`slot_key`) REFERENCES `profile_slot_bindings`(`profile_id`,`slot_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_slot_sources_source_idx` ON `profile_slot_sources` (`source_id`,`profile_id`);--> statement-breakpoint
DROP TABLE `profile_source_bindings`;