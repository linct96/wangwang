INSERT INTO `sources` (`id`, `name`, `kind`, `status`, `created_at`, `updated_at`)
VALUES ('system-manual', '手动节点', 'manual', 'ready', unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT (`id`) DO NOTHING;
