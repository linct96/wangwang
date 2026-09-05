PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_profile_node_binding` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`include_regex` text,
	`exclude_regex` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_node_binding_mode_check" CHECK("__new_profile_node_binding"."mode" IN ('source', 'node', 'tag')),
	CONSTRAINT "profile_node_binding_node_regex_check" CHECK("__new_profile_node_binding"."mode" IN ('source', 'tag') OR ("__new_profile_node_binding"."include_regex" IS NULL AND "__new_profile_node_binding"."exclude_regex" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_profile_node_binding`("profile_id", "mode", "include_regex", "exclude_regex") SELECT "profile_id", "mode", "include_regex", "exclude_regex" FROM `profile_node_binding`;--> statement-breakpoint
DROP TABLE `profile_node_binding`;--> statement-breakpoint
ALTER TABLE `__new_profile_node_binding` RENAME TO `profile_node_binding`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_profile_slot_bindings` (
	`profile_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`mode` text NOT NULL,
	`include_regex` text,
	`exclude_regex` text,
	PRIMARY KEY(`profile_id`, `slot_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_slot_bindings_mode_check" CHECK("__new_profile_slot_bindings"."mode" IN ('source', 'node', 'tag')),
	CONSTRAINT "profile_slot_bindings_node_regex_check" CHECK("__new_profile_slot_bindings"."mode" IN ('source', 'tag') OR ("__new_profile_slot_bindings"."include_regex" IS NULL AND "__new_profile_slot_bindings"."exclude_regex" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_profile_slot_bindings`("profile_id", "slot_key", "mode", "include_regex", "exclude_regex") SELECT "profile_id", "slot_key", "mode", "include_regex", "exclude_regex" FROM `profile_slot_bindings`;--> statement-breakpoint
DROP TABLE `profile_slot_bindings`;--> statement-breakpoint
ALTER TABLE `__new_profile_slot_bindings` RENAME TO `profile_slot_bindings`;