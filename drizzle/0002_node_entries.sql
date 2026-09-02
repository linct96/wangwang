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
CREATE INDEX `node_entries_node_idx` ON `node_entries` (`node_id`);
--> statement-breakpoint
CREATE TABLE `node_entry_tags` (
	`entry_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `node_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `node_entry_tags_tag_idx` ON `node_entry_tags` (`tag_id`,`entry_id`);
--> statement-breakpoint
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
CREATE UNIQUE INDEX `source_entries_key_idx` ON `source_entries` (`source_id`,`source_key`);
--> statement-breakpoint
CREATE INDEX `source_entries_entry_idx` ON `source_entries` (`entry_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
SELECT n.id, n.id, COALESCE(json_extract(n.config, '$.name'), n.server || ':' || n.port), n.alias, n.enabled, n.created_at, n.updated_at
FROM nodes n;
--> statement-breakpoint
INSERT OR IGNORE INTO node_entries (id, node_id, name, alias, enabled, created_at, updated_at)
SELECT n.id || ':manual', n.id, COALESCE(
  (SELECT sn.original_name
   FROM source_nodes sn
   JOIN sources s ON s.id = sn.source_id
   WHERE sn.node_id = n.id AND s.kind = 'manual'
   ORDER BY sn.position
   LIMIT 1),
  json_extract(n.config, '$.name'),
  n.server || ':' || n.port
), n.alias, n.enabled, n.created_at, n.updated_at
FROM nodes n
WHERE EXISTS (
  SELECT 1
  FROM source_nodes sn
  JOIN sources s ON s.id = sn.source_id
  WHERE sn.node_id = n.id AND s.kind = 'manual'
)
AND EXISTS (
  SELECT 1
  FROM source_nodes sn
  JOIN sources s ON s.id = sn.source_id
  WHERE sn.node_id = n.id AND s.kind = 'url'
);
--> statement-breakpoint
INSERT OR IGNORE INTO node_entry_tags (entry_id, tag_id)
SELECT nt.node_id, nt.tag_id FROM node_tags nt;
--> statement-breakpoint
INSERT OR IGNORE INTO node_entry_tags (entry_id, tag_id)
SELECT n.id || ':manual', nt.tag_id
FROM nodes n
JOIN node_tags nt ON nt.node_id = n.id
WHERE EXISTS (
  SELECT 1
  FROM source_nodes sn
  JOIN sources s ON s.id = sn.source_id
  WHERE sn.node_id = n.id AND s.kind = 'manual'
)
AND EXISTS (
  SELECT 1
  FROM source_nodes sn
  JOIN sources s ON s.id = sn.source_id
  WHERE sn.node_id = n.id AND s.kind = 'url'
);
--> statement-breakpoint
INSERT OR IGNORE INTO source_entries (source_id, entry_id, source_key, original_name, position)
SELECT sn.source_id,
       CASE WHEN s.kind = 'manual' AND EXISTS (
         SELECT 1
         FROM source_nodes sn2
         JOIN sources s2 ON s2.id = sn2.source_id
         WHERE sn2.node_id = sn.node_id AND s2.kind = 'url'
       ) THEN n.id || ':manual' ELSE n.id END,
       CASE WHEN s.kind = 'url' THEN n.fingerprint ELSE sn.node_id END,
       sn.original_name, sn.position
FROM source_nodes sn
JOIN sources s ON s.id = sn.source_id
JOIN nodes n ON n.id = sn.node_id;
--> statement-breakpoint
UPDATE sources
SET node_count = (SELECT count(*) FROM source_entries WHERE source_entries.source_id = sources.id);
