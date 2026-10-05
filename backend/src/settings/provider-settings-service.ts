import { eq, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../db/database.js";
import { aiProviderSettings, receiptProcessingSettings } from "../db/schema.js";
import {
  DEFAULT_OLLAMA_BASE_URL,
  parseProviderUpdate,
  providerIdSchema,
  providerIds,
  ProviderSettingsError,
  type ProviderId,
  type PublicProviderSettings,
} from "./provider-settings.js";
import { SecretStorage, SecretStorageError } from "./secret-storage.js";

type SettingsDatabase = ReturnType<typeof createDatabase>["db"];
type ProviderRow = typeof aiProviderSettings.$inferSelect;

/**
 * Parses and validates a provider identifier.
 * @param input The input value to parse as a provider identifier.
 * @returns The validated provider identifier.
 */
function parseProvider(input: unknown): ProviderId {
  const parsed = providerIdSchema.safeParse(input);
  if (!parsed.success)
    throw new ProviderSettingsError("invalid_provider_settings");
  return parsed.data;
}

/**
 * Service for managing provider settings.
 * Interacts with the SQLite database and secret storage to retrieve and update provider configurations.
 * SQLite is the sole source of provider configuration; provider environment variables are never read.
 */
export class ProviderSettingsService {
  constructor(
    private readonly db: SettingsDatabase,
    private readonly secrets = new SecretStorage(),
  ) {
    db.transaction((tx) => {
      for (const provider of providerIds) {
        tx.insert(aiProviderSettings)
          .values({
            provider,
            enabled: false,
            model: "",
            ollamaBaseUrl:
              provider === "ollama" ? DEFAULT_OLLAMA_BASE_URL : null,
          })
          .onConflictDoNothing()
          .run();
      }
      tx.insert(receiptProcessingSettings)
        .values({ id: 1, defaultProvider: null })
        .onConflictDoNothing()
        .run();
    });
  }

  /**
   * Retrieves the database row for a specific provider.
   * @param provider The provider identifier.
   * @returns The database row corresponding to the provider.
   * @throws {ProviderSettingsError} If the provider is not found in the database.
   */
  private row(provider: ProviderId): ProviderRow {
    const row = this.db
      .select()
      .from(aiProviderSettings)
      .where(eq(aiProviderSettings.provider, provider))
      .get();
    if (!row) throw new ProviderSettingsError("invalid_provider_settings");
    return row;
  }

  /**
   * Converts a database row into a public-facing provider settings object.
   * @param row The database row for the provider.
   * @returns The public-facing provider settings.
   */
  private publicProvider(row: ProviderRow): PublicProviderSettings {
    const configurationIssues: PublicProviderSettings["configurationIssues"] =
      [];
    if (!row.model) configurationIssues.push("missing_model");
    if (row.provider === "ollama" && !row.ollamaBaseUrl)
      configurationIssues.push("missing_base_url");
    if (row.provider !== "ollama") {
      if (!row.apiKeyEncrypted) configurationIssues.push("missing_api_key");
      else {
        try {
          this.secrets.decrypt(row.provider, row.apiKeyEncrypted);
        } catch (error) {
          if (!(error instanceof SecretStorageError)) throw error;
          configurationIssues.push("secret_unavailable");
        }
      }
    }
    // Construct explicitly: never spread a database row into a public response.
    return {
      provider: row.provider,
      enabled: row.enabled,
      model: row.model,
      ...(row.provider === "ollama"
        ? { baseUrl: row.ollamaBaseUrl ?? "" }
        : {}),
      hasApiKey: row.apiKeyEncrypted !== null,
      selectable: row.enabled && configurationIssues.length === 0,
      configurationIssues,
    };
  }

  /**
   * Retrieves the current provider settings, including all providers and the default provider.
   * @returns An object containing the list of provider settings and the default provider.
   */
  getSettings() {
    return {
      providers: providerIds.map((provider) =>
        this.publicProvider(this.row(provider)),
      ),
      defaultProvider: this.db
        .select()
        .from(receiptProcessingSettings)
        .where(eq(receiptProcessingSettings.id, 1))
        .get()!.defaultProvider,
    };
  }

  /**
   * Updates the settings for a specific provider.
   * @param providerInput The identifier of the provider to update.
   * @param input The new settings for the provider.
   * @returns The updated public-facing provider settings.
   * @throws {ProviderSettingsError} If the update is invalid or incomplete.
   */
  updateProvider(
    providerInput: unknown,
    input: unknown,
  ): PublicProviderSettings {
    const provider = parseProvider(providerInput);
    const update = parseProviderUpdate(provider, input);
    return this.db.transaction((tx) => {
      const current = this.row(provider);
      let apiKeyEncrypted = current.apiKeyEncrypted;
      if (update.apiKey?.action === "remove") apiKeyEncrypted = null;
      if (update.apiKey?.action === "set") {
        const existing = tx
          .select()
          .from(aiProviderSettings)
          .where(isNotNull(aiProviderSettings.apiKeyEncrypted))
          .all();
        // Refuse silent replacement of missing/wrong key material while stored secrets exist.
        for (const row of existing)
          this.secrets.decrypt(row.provider, row.apiKeyEncrypted!);
        apiKeyEncrypted = this.secrets.encrypt(
          provider,
          update.apiKey.value,
          existing.length > 0,
        );
      }
      const next: ProviderRow = {
        ...current,
        enabled: update.enabled ?? current.enabled,
        model: update.model ?? current.model,
        ollamaBaseUrl: update.baseUrl ?? current.ollamaBaseUrl,
        apiKeyEncrypted,
      };
      // Removing a required key explicitly disables the provider and clears its default.
      if (update.apiKey?.action === "remove") {
        if (update.enabled === true)
          throw new ProviderSettingsError("provider_configuration_incomplete");
        next.enabled = false;
      }
      const result = this.publicProvider(next);
      if (next.enabled && !result.selectable) {
        if (
          next.apiKeyEncrypted &&
          result.configurationIssues.includes("secret_unavailable")
        ) {
          this.secrets.decrypt(provider, next.apiKeyEncrypted);
        }
        throw new ProviderSettingsError("provider_configuration_incomplete");
      }
      tx.update(aiProviderSettings)
        .set(next)
        .where(eq(aiProviderSettings.provider, provider))
        .run();
      if (!result.selectable) {
        tx.update(receiptProcessingSettings)
          .set({ defaultProvider: null })
          .where(eq(receiptProcessingSettings.defaultProvider, provider))
          .run();
      }
      return result;
    });
  }

  /**
   * Sets the default provider for receipt processing.
   * @param input The identifier of the provider to set as default, or null to unset.
   * @returns The identifier of the new default provider, or null if unset.
   */
  setDefaultProvider(input: unknown): ProviderId | null {
    const provider = input === null ? null : parseProvider(input);
    return this.db.transaction((tx) => {
      if (
        provider !== null &&
        !this.publicProvider(this.row(provider)).selectable
      ) {
        throw new ProviderSettingsError("provider_not_selectable");
      }
      tx.update(receiptProcessingSettings)
        .set({ defaultProvider: provider })
        .where(eq(receiptProcessingSettings.id, 1))
        .run();
      return provider;
    });
  }
}
