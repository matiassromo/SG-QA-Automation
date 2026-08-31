CREATE TABLE `rfc_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project` text NOT NULL,
	`name` text NOT NULL,
	`original_file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`content_base64` text NOT NULL,
	`extracted_text` text NOT NULL,
	`hu_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
