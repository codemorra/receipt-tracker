import { z } from "zod";

export const providerIds = ["ollama", "mistral", "openai"] as const;
export type ProviderId = (typeof providerIds)[number];
export const providerIdSchema = z.enum(providerIds);
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

// Default base URL for the Ollama provider.
export class ProviderSettingsError extends Error {
  constructor(
    public readonly code:
      | "invalid_provider_settings"
      | "provider_configuration_incomplete"
      | "provider_not_selectable",
  ) {
    super(code);
    this.name = "ProviderSettingsError";
  }
}

/**
 * Normalizes and validates the base URL for the Ollama provider.
 * @param value The input base URL to normalize.
 * @returns The normalized base URL.
 * @throws {ProviderSettingsError} If the input is not a valid URL.
 */
export function normalizeOllamaBaseUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error();
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new ProviderSettingsError("invalid_provider_settings");
  }
}

// Schema for validating provider update inputs.
const providerUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    model: z.string().trim().max(256).optional(),
    baseUrl: z.string().trim().min(1).max(2048).optional(),
    apiKey: z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("set"),
            value: z.string().trim().min(1).max(16384),
          })
          .strict(),
        z.object({ action: z.literal("remove") }).strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

/**
 * Parses and validates the provider update input.
 * @param provider The provider identifier.
 * @param input The input value to parse as a provider update.
 * @returns The validated provider update data.
 * @throws {ProviderSettingsError} If the input is invalid for the specified provider.
 */
export function parseProviderUpdate(provider: ProviderId, input: unknown) {
  const parsed = providerUpdateSchema.safeParse(input);
  if (
    !parsed.success ||
    (provider === "ollama" && parsed.data.apiKey) ||
    (provider !== "ollama" && parsed.data.baseUrl !== undefined)
  ) {
    // Do not expose Zod input values, which may contain a submitted API key.
    throw new ProviderSettingsError("invalid_provider_settings");
  }
  if (parsed.data.baseUrl !== undefined) {
    parsed.data.baseUrl = normalizeOllamaBaseUrl(parsed.data.baseUrl);
  }
  return parsed.data;
}

// Types and interfaces for public-facing provider settings.
export type ProviderConfigurationIssue =
  | "missing_model"
  | "missing_base_url"
  | "missing_api_key"
  | "secret_unavailable";

// Interface for public-facing provider settings.
export interface PublicProviderSettings {
  provider: ProviderId;
  enabled: boolean;
  model: string;
  baseUrl?: string;
  hasApiKey: boolean;
  selectable: boolean;
  configurationIssues: ProviderConfigurationIssue[];
}
