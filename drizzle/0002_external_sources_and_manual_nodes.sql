ALTER TABLE `sources` ADD COLUMN `pending_url` text;

INSERT OR IGNORE INTO `sources` (
  `id`, `name`, `kind`, `url`, `content`, `refresh_interval_hours`, `enabled`, `status`,
  `node_count`, `created_at`, `updated_at`
) VALUES (
  'system-manual', '手动节点', 'manual', NULL, NULL, 0, 1, 'ready', 0,
  unixepoch() * 1000, unixepoch() * 1000
);

INSERT OR IGNORE INTO `source_nodes` (`source_id`, `node_id`, `original_name`, `position`)
SELECT 'system-manual', sn.`node_id`, sn.`original_name`, sn.`position`
FROM `source_nodes` sn
JOIN `sources` s ON s.`id` = sn.`source_id`
WHERE s.`kind` = 'manual' AND s.`id` <> 'system-manual';

INSERT OR IGNORE INTO `profile_sources` (`profile_id`, `source_id`)
SELECT ps.`profile_id`, 'system-manual'
FROM `profile_sources` ps
JOIN `sources` s ON s.`id` = ps.`source_id`
WHERE s.`kind` = 'manual' AND s.`id` <> 'system-manual';

DELETE FROM `sources` WHERE `kind` = 'manual' AND `id` <> 'system-manual';

UPDATE `sources`
SET `node_count` = (SELECT count(*) FROM `source_nodes` WHERE `source_id` = 'system-manual')
WHERE `id` = 'system-manual';

DELETE FROM `nodes`
WHERE NOT EXISTS (SELECT 1 FROM `source_nodes` WHERE `source_nodes`.`node_id` = `nodes`.`id`);
