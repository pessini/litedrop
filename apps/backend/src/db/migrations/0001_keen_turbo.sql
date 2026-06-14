CREATE TABLE `abuse_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`share_id` text NOT NULL,
	`reporter_ip` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`share_id`) REFERENCES `shares`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `abuse_reports_share_reporter_uq` ON `abuse_reports` (`share_id`,`reporter_ip`);