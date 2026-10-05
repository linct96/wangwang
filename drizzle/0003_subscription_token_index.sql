ALTER TABLE `profiles` ADD `subscription_token_hash` text;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_subscription_token_hash_idx` ON `profiles` (`subscription_token_hash`);