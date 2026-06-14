CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`sha256` text NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`max_views` integer,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`revoked_at` integer,
	`storage_deleted_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_slug_unique` ON `shares` (`slug`);