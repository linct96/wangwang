CREATE TABLE `admin_account` (
	`id` integer PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "admin_account_singleton_check" CHECK("admin_account"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`entity_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `jobs_entity_idx` ON `jobs` (`type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `node_tags` (
	`node_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`node_id`, `tag_id`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_tags_tag_idx` ON `node_tags` (`tag_id`,`node_id`);--> statement-breakpoint
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
CREATE INDEX `nodes_source_position_idx` ON `nodes` (`source_id`,`position`);--> statement-breakpoint
CREATE INDEX `nodes_physical_idx` ON `nodes` (`physical_node_id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `physical_nodes_fingerprint_idx` ON `physical_nodes` (`fingerprint`);--> statement-breakpoint
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
	`position` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `slot_key`, `node_id`),
	FOREIGN KEY (`profile_id`,`slot_key`) REFERENCES `profile_slot_bindings`(`profile_id`,`slot_key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_slot_nodes_node_idx` ON `profile_slot_nodes` (`node_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `profile_slot_nodes_slot_position_idx` ON `profile_slot_nodes` (`profile_id`,`slot_key`,`position`);--> statement-breakpoint
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
CREATE TABLE `profile_tag_filters` (
	`profile_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `tag_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_tag_filters_tag_idx` ON `profile_tag_filters` (`tag_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`template_id` text DEFAULT 'builtin:minimal' NOT NULL,
	`token_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`compiled_yaml` text,
	`compiled_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profiles_template_id_idx` ON `profiles` (`template_id`);--> statement-breakpoint
CREATE TABLE `source_tags` (
	`source_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`source_id`, `tag_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_tags_tag_idx` ON `source_tags` (`tag_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`pending_url` text,
	`node_name_filter` text,
	`user_agent` text DEFAULT 'mihomo' NOT NULL,
	`refresh_interval_hours` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`etag` text,
	`last_modified` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`warning` text,
	`error` text,
	`node_count` integer DEFAULT 0 NOT NULL,
	`upload_bytes` integer,
	`download_bytes` integer,
	`total_bytes` integer,
	`expire_at` integer,
	`info_refreshed_at` integer,
	`last_refreshed_at` integer,
	`next_refresh_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_due_idx` ON `sources` (`enabled`,`next_refresh_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_idx` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `template_slots` (
	`template_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`template_id`, `key`),
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`yaml` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `sources` (`id`, `name`, `kind`, `status`, `created_at`, `updated_at`)
VALUES ('system-manual', '手动节点', 'manual', 'ready', unixepoch() * 1000, unixepoch() * 1000);
