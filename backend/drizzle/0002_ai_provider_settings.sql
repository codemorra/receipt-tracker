CREATE TABLE `ai_provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`ollama_base_url` text,
	`api_key_encrypted` text,
	CONSTRAINT "ai_provider_id" CHECK("ai_provider_settings"."provider" IN ('ollama', 'mistral', 'openai')),
	CONSTRAINT "ai_provider_enabled" CHECK("ai_provider_settings"."enabled" IN (0, 1)),
	CONSTRAINT "ai_provider_url" CHECK("ai_provider_settings"."provider" = 'ollama' OR "ai_provider_settings"."ollama_base_url" IS NULL),
	CONSTRAINT "ai_provider_secret" CHECK("ai_provider_settings"."provider" != 'ollama' OR "ai_provider_settings"."api_key_encrypted" IS NULL)
);
--> statement-breakpoint
CREATE TABLE `receipt_processing_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_provider` text,
	FOREIGN KEY (`default_provider`) REFERENCES `ai_provider_settings`(`provider`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipt_processing_singleton" CHECK("receipt_processing_settings"."id" = 1)
);
