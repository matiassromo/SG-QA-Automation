CREATE TABLE `qa_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`name` text NOT NULL,
	`iteration` text NOT NULL,
	`plan_id` integer,
	`plan_name` text NOT NULL,
	`rfc_ids` text DEFAULT '[]' NOT NULL,
	`requirement_ids` text DEFAULT '[]' NOT NULL,
	`configurations` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`analysis` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_qa_campaigns_project` ON `qa_campaigns` (`project`);
