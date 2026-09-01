CREATE TABLE IF NOT EXISTS `automation_analyses` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `project` text NOT NULL, `plan_id` integer NOT NULL,
  `suite_id` integer NOT NULL, `test_case_id` integer NOT NULL, `status` text DEFAULT 'NOT_ANALYZED' NOT NULL,
  `automatable` integer DEFAULT 0 NOT NULL, `confidence` real DEFAULT 0 NOT NULL, `reason` text DEFAULT '' NOT NULL,
  `requirements` text DEFAULT '[]' NOT NULL, `missing_context` text DEFAULT '[]' NOT NULL,
  `capabilities` text DEFAULT '[]' NOT NULL, `analyzed_at` text NOT NULL, `updated_at` text NOT NULL,
  UNIQUE(`project`,`plan_id`,`suite_id`,`test_case_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automation_analyses_suite` ON `automation_analyses` (`project`,`plan_id`,`suite_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automation_project_settings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `project` text NOT NULL UNIQUE, `application_type` text DEFAULT 'web' NOT NULL,
  `base_url` text DEFAULT '' NOT NULL, `username_env` text DEFAULT '' NOT NULL, `password_env` text DEFAULT '' NOT NULL,
  `auth_mode` text DEFAULT 'form' NOT NULL, `login_path` text DEFAULT '/' NOT NULL, `username_locator` text DEFAULT '' NOT NULL,
  `password_locator` text DEFAULT '' NOT NULL, `submit_locator` text DEFAULT '' NOT NULL, `authenticated_locator` text DEFAULT '' NOT NULL,
  `navigation_locator` text DEFAULT '' NOT NULL, `configuration_mappings` text DEFAULT '{}' NOT NULL, `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automation_recipes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `project` text NOT NULL, `plan_id` integer NOT NULL,
  `suite_id` integer NOT NULL, `test_case_id` integer NOT NULL, `operations` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'DRAFT' NOT NULL, `updated_at` text NOT NULL, UNIQUE(`project`,`plan_id`,`suite_id`,`test_case_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automation_recipes_scope` ON `automation_recipes` (`project`,`plan_id`,`suite_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `automation_artifacts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `project` text NOT NULL, `plan_id` integer NOT NULL,
  `suite_id` integer NOT NULL, `test_case_id` integer NOT NULL, `file_name` text NOT NULL, `source` text NOT NULL, `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_automation_artifacts_scope` ON `automation_artifacts` (`project`,`plan_id`,`suite_id`,`test_case_id`);
