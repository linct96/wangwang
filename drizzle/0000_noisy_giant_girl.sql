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
CREATE TABLE `node_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`name` text NOT NULL,
	`alias` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_entries_node_idx` ON `node_entries` (`node_id`);--> statement-breakpoint
CREATE TABLE `node_entry_tags` (
	`entry_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `node_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_entry_tags_tag_idx` ON `node_entry_tags` (`tag_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `nodes` (
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
CREATE UNIQUE INDEX `nodes_fingerprint_idx` ON `nodes` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `profile_sources` (
	`profile_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `source_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `source_entries` (
	`source_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`source_key` text NOT NULL,
	`original_name` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`source_id`, `entry_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `node_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_entries_key_idx` ON `source_entries` (`source_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `source_entries_entry_idx` ON `source_entries` (`entry_id`);--> statement-breakpoint
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
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`yaml` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
