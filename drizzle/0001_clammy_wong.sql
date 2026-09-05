PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `profile_node_binding_new` (
  `profile_id` text PRIMARY KEY NOT NULL,
  `mode` text NOT NULL,
  `include_regex` text,
  `exclude_regex` text,
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `profile_node_binding_mode_check` CHECK(`mode` IN ('source', 'node', 'tag')),
  CONSTRAINT `profile_node_binding_node_regex_check` CHECK(`mode` = 'source' OR (`include_regex` IS NULL AND `exclude_regex` IS NULL))
);
--> statement-breakpoint
INSERT INTO `profile_node_binding_new` SELECT * FROM `profile_node_binding`;
--> statement-breakpoint
DROP TABLE `profile_node_binding`;
--> statement-breakpoint
ALTER TABLE `profile_node_binding_new` RENAME TO `profile_node_binding`;
--> statement-breakpoint
CREATE TABLE `profile_slot_bindings_new` (
  `profile_id` text NOT NULL,
  `slot_key` text NOT NULL,
  `mode` text NOT NULL,
  `include_regex` text,
  `exclude_regex` text,
  PRIMARY KEY(`profile_id`, `slot_key`),
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `profile_slot_bindings_mode_check` CHECK(`mode` IN ('source', 'node', 'tag')),
  CONSTRAINT `profile_slot_bindings_node_regex_check` CHECK(`mode` = 'source' OR (`include_regex` IS NULL AND `exclude_regex` IS NULL))
);
--> statement-breakpoint
INSERT INTO `profile_slot_bindings_new` SELECT * FROM `profile_slot_bindings`;
--> statement-breakpoint
DROP TABLE `profile_slot_bindings`;
--> statement-breakpoint
ALTER TABLE `profile_slot_bindings_new` RENAME TO `profile_slot_bindings`;
--> statement-breakpoint
CREATE TABLE `profile_node_tags` (
  `profile_id` text NOT NULL,
  `tag_id` text NOT NULL,
  PRIMARY KEY(`profile_id`, `tag_id`),
  FOREIGN KEY (`profile_id`) REFERENCES `profile_node_binding`(`profile_id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_node_tags_tag_idx` ON `profile_node_tags` (`tag_id`, `profile_id`);
--> statement-breakpoint
CREATE TABLE `profile_slot_tags` (
  `profile_id` text NOT NULL,
  `slot_key` text NOT NULL,
  `tag_id` text NOT NULL,
  PRIMARY KEY(`profile_id`, `slot_key`, `tag_id`),
  FOREIGN KEY (`profile_id`, `slot_key`) REFERENCES `profile_slot_bindings`(`profile_id`, `slot_key`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_slot_tags_tag_idx` ON `profile_slot_tags` (`tag_id`, `profile_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
