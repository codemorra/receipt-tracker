import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { providerIds } from "../../extraction/receipt-extraction-provider.js";

// AI provider settings table definition.
export const aiProviderSettings = sqliteTable(
  "ai_provider_settings",
  {
    provider: text("provider", {
      enum: providerIds,
    }).primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    model: text("model").notNull().default(""),
    ollamaBaseUrl: text("ollama_base_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
  },
  (table) => [
    check("ai_provider_id", sql`${table.provider} IN ('ollama', 'openai')`),
    check("ai_provider_enabled", sql`${table.enabled} IN (0, 1)`),
    check(
      "ai_provider_url",
      sql`${table.provider} = 'ollama' OR ${table.ollamaBaseUrl} IS NULL`,
    ),
    check(
      "ai_provider_secret",
      sql`${table.provider} != 'ollama' OR ${table.apiKeyEncrypted} IS NULL`,
    ),
  ],
);

// Receipt processing settings table definition.
export const receiptProcessingSettings = sqliteTable(
  "receipt_processing_settings",
  {
    id: integer("id").primaryKey(),
    defaultProvider: text("default_provider", {
      enum: providerIds,
    }).references(() => aiProviderSettings.provider),
  },
  (table) => [check("receipt_processing_singleton", sql`${table.id} = 1`)],
);
