CREATE TABLE `execution_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_by` text NOT NULL,
	`project` text NOT NULL,
	`plan_id` integer NOT NULL,
	`suite_id` integer NOT NULL,
	`configuration` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` text NOT NULL
);
