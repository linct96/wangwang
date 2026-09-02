CREATE TABLE `tags` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_idx` ON `tags` (`normalized_name`);
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
--> statement-breakpoint
CREATE TABLE `source_tags` (
  `source_id` text NOT NULL,
  `tag_id` text NOT NULL,
  PRIMARY KEY(`source_id`, `tag_id`),
  FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_tags_tag_idx` ON `source_tags` (`tag_id`,`source_id`);
--> statement-breakpoint
CREATE TABLE `profile_tag_filters` (
  `profile_id` text NOT NULL,
  `tag_id` text NOT NULL,
  PRIMARY KEY(`profile_id`, `tag_id`),
  FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_tag_filters_tag_idx` ON `profile_tag_filters` (`tag_id`,`profile_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(CAST(j.value AS TEXT)), lower(trim(CAST(j.value AS TEXT))), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM nodes n, json_each(n.tags) j
WHERE trim(CAST(j.value AS TEXT)) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(s.node_tag), lower(trim(s.node_tag)), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM sources s
WHERE s.node_tag IS NOT NULL AND trim(s.node_tag) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO tags (id, name, normalized_name, created_at, updated_at)
SELECT 'tag_' || lower(hex(randomblob(12))), trim(CAST(j.value AS TEXT)), lower(trim(CAST(j.value AS TEXT))), unixepoch('subsec') * 1000, unixepoch('subsec') * 1000
FROM profiles p, json_each(p.tags) j
WHERE trim(CAST(j.value AS TEXT)) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO node_tags (node_id, tag_id)
SELECT n.id, t.id
FROM nodes n, json_each(n.tags) j
JOIN tags t ON t.normalized_name = lower(trim(CAST(j.value AS TEXT)))
WHERE trim(CAST(j.value AS TEXT)) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO source_tags (source_id, tag_id)
SELECT s.id, t.id
FROM sources s
JOIN tags t ON t.normalized_name = lower(trim(s.node_tag))
WHERE s.node_tag IS NOT NULL AND trim(s.node_tag) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO profile_tag_filters (profile_id, tag_id)
SELECT p.id, t.id
FROM profiles p, json_each(p.tags) j
JOIN tags t ON t.normalized_name = lower(trim(CAST(j.value AS TEXT)))
WHERE trim(CAST(j.value AS TEXT)) <> '';
