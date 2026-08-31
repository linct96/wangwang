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
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`protocol` text NOT NULL,
	`server` text NOT NULL,
	`port` integer NOT NULL,
	`config` text NOT NULL,
	`alias` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
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
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
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
CREATE TABLE `source_nodes` (
	`source_id` text NOT NULL,
	`node_id` text NOT NULL,
	`original_name` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`source_id`, `node_id`),
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_nodes_node_idx` ON `source_nodes` (`node_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`pending_url` text,
	`node_name_filter` text,
	`node_tag` text,
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
