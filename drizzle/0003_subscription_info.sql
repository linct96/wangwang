ALTER TABLE sources ADD COLUMN upload_bytes INTEGER;
ALTER TABLE sources ADD COLUMN download_bytes INTEGER;
ALTER TABLE sources ADD COLUMN total_bytes INTEGER;
ALTER TABLE sources ADD COLUMN expire_at INTEGER;
ALTER TABLE sources ADD COLUMN info_refreshed_at INTEGER;
