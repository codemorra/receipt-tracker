-- Rebuild both settings tables while foreign key enforcement remains enabled.
CREATE TABLE `__new_ai_provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`ollama_base_url` text,
	`api_key_encrypted` text,
	CONSTRAINT "ai_provider_id" CHECK("__new_ai_provider_settings"."provider" IN ('ollama', 'openai')),
	CONSTRAINT "ai_provider_enabled" CHECK("__new_ai_provider_settings"."enabled" IN (0, 1)),
	CONSTRAINT "ai_provider_url" CHECK("__new_ai_provider_settings"."provider" = 'ollama' OR "__new_ai_provider_settings"."ollama_base_url" IS NULL),
	CONSTRAINT "ai_provider_secret" CHECK("__new_ai_provider_settings"."provider" != 'ollama' OR "__new_ai_provider_settings"."api_key_encrypted" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_ai_provider_settings` (provider, enabled, model, ollama_base_url, api_key_encrypted)
SELECT provider, enabled, model, ollama_base_url, api_key_encrypted
FROM ai_provider_settings WHERE provider IN ('ollama', 'openai');
--> statement-breakpoint
CREATE TABLE `__new_receipt_processing_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `default_provider` text,
  FOREIGN KEY (`default_provider`) REFERENCES `__new_ai_provider_settings`(`provider`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "receipt_processing_singleton" CHECK("__new_receipt_processing_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_receipt_processing_settings` (id, default_provider)
SELECT id, CASE WHEN default_provider IN ('ollama', 'openai') THEN default_provider ELSE NULL END
FROM receipt_processing_settings;
--> statement-breakpoint
DROP TABLE `receipt_processing_settings`;
--> statement-breakpoint
DROP TABLE `ai_provider_settings`;
--> statement-breakpoint
ALTER TABLE `__new_ai_provider_settings` RENAME TO `ai_provider_settings`;
--> statement-breakpoint
ALTER TABLE `__new_receipt_processing_settings` RENAME TO `receipt_processing_settings`;
