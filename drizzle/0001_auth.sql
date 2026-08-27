CREATE TABLE `admin_account` (
  `id` integer PRIMARY KEY CHECK (`id` = 1),
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `created_at` integer NOT NULL
);
CREATE TABLE `admin_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
CREATE INDEX `admin_sessions_expiry_idx` ON `admin_sessions` (`expires_at`);
