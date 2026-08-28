CREATE TABLE `templates` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `yaml` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

ALTER TABLE `profiles` ADD COLUMN `template_id` text DEFAULT 'builtin:minimal' NOT NULL;
CREATE INDEX `profiles_template_id_idx` ON `profiles` (`template_id`);
