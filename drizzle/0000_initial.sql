PRAGMA foreign_keys = ON;

CREATE TABLE `sources` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `url` text,
  `content` text,
  `refresh_interval_hours` integer DEFAULT 0 NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `etag` text,
  `last_modified` text,
  `status` text DEFAULT 'idle' NOT NULL,
  `warning` text,
  `error` text,
  `node_count` integer DEFAULT 0 NOT NULL,
  `last_refreshed_at` integer,
  `next_refresh_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX `sources_due_idx` ON `sources` (`enabled`, `next_refresh_at`);

CREATE TABLE `nodes` (
  `id` text PRIMARY KEY NOT NULL,
  `fingerprint` text NOT NULL,
  `protocol` text NOT NULL,
  `server` text NOT NULL,
  `port` integer NOT NULL,
  `config` text NOT NULL,
  `alias` text,
  `tags` text DEFAULT '[]' NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `nodes_fingerprint_idx` ON `nodes` (`fingerprint`);

CREATE TABLE `source_nodes` (
  `source_id` text NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  `node_id` text NOT NULL REFERENCES `nodes`(`id`) ON DELETE CASCADE,
  `original_name` text NOT NULL,
  `position` integer NOT NULL,
  PRIMARY KEY (`source_id`, `node_id`)
);
CREATE INDEX `source_nodes_node_idx` ON `source_nodes` (`node_id`);

CREATE TABLE `profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `protocols` text DEFAULT '[]' NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `rule_modules` text DEFAULT '["ads","private","cn"]' NOT NULL,
  `dns_mode` text DEFAULT 'fake-ip' NOT NULL,
  `token_version` integer DEFAULT 1 NOT NULL,
  `revision` integer DEFAULT 0 NOT NULL,
  `compiled_yaml` text,
  `compiled_at` integer,
  `error` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `profile_sources` (
  `profile_id` text NOT NULL REFERENCES `profiles`(`id`) ON DELETE CASCADE,
  `source_id` text NOT NULL REFERENCES `sources`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`profile_id`, `source_id`)
);

CREATE TABLE `profile_node_exclusions` (
  `profile_id` text NOT NULL REFERENCES `profiles`(`id`) ON DELETE CASCADE,
  `node_id` text NOT NULL REFERENCES `nodes`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`profile_id`, `node_id`)
);

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
CREATE INDEX `jobs_entity_idx` ON `jobs` (`type`, `entity_id`, `created_at`);
