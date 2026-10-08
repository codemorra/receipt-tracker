export const providerIds = ["ollama", "openai"] as const;
export type ProviderId = (typeof providerIds)[number];

// List of supported provider IDs and their corresponding type.
export type ConfigurationIssue =
  | "missing_model"
  | "missing_base_url"
  | "missing_api_key"
  | "secret_unavailable";

// API for managing provider settings, including fetching current settings, updating configurations, and handling errors.
export interface ProviderSettings {
  provider: ProviderId;
  enabled: boolean;
  model: string;
  baseUrl?: string;
  hasApiKey: boolean;
  selectable: boolean;
  configurationIssues: ConfigurationIssue[];
}

// API for managing AI settings, including the list of providers and the default provider.
export interface AiSettings {
  providers: ProviderSettings[];
  defaultProvider: ProviderId | null;
}

// API for updating provider configurations, including resetting to default and specifying credentials.
export interface ProviderUpdate {
  enabled: boolean;
  model: string;
  baseUrl?: string;
  apiKey?: { action: "set"; value: string } | { action: "remove" };
}

// Restore the provider's empty configuration, including its credentials.
export function providerResetUpdate(provider: ProviderId): ProviderUpdate {
  return {
    enabled: false,
    model: "",
    ...(provider === "ollama"
      ? { baseUrl: "http://127.0.0.1:11434" }
      : { apiKey: { action: "remove" as const } }),
  };
}

// API for resetting a provider's configuration to its default state, including removing credentials.
const errorCodes = [
  "invalid_provider_settings",
  "provider_configuration_incomplete",
  "provider_not_selectable",
  "secret_key_unavailable",
  "secret_decryption_failed",
  "provider_settings_failed",
  "settings_request_forbidden",
  "settings_json_required",
  "settings_payload_too_large",
  "invalid_request",
  "network_error",
  "unexpected_response",
] as const;
export type SettingsErrorCode = (typeof errorCodes)[number];

// List of possible error codes returned by the provider settings API.
export class ProviderSettingsApiError extends Error {
  readonly code: SettingsErrorCode;
  constructor(code: SettingsErrorCode) {
    super(code);
    this.name = "ProviderSettingsApiError";
    this.code = code;
  }
}

// Utility function to check if a value is a plain object.
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Utility function to check if a value is a valid provider ID.
function isProvider(value: unknown): value is ProviderId {
  return providerIds.some((provider) => provider === value);
}

// Utility function to validate and extract the public-facing provider settings from a raw value.
function publicProvider(value: unknown): ProviderSettings {
  if (
    !isRecord(value) ||
    !isProvider(value.provider) ||
    typeof value.enabled !== "boolean" ||
    typeof value.model !== "string" ||
    typeof value.hasApiKey !== "boolean" ||
    typeof value.selectable !== "boolean" ||
    (value.baseUrl !== undefined && typeof value.baseUrl !== "string") ||
    !Array.isArray(value.configurationIssues) ||
    !value.configurationIssues.every((issue) =>
      [
        "missing_model",
        "missing_base_url",
        "missing_api_key",
        "secret_unavailable",
      ].includes(issue),
    )
  ) {
    throw new ProviderSettingsApiError("unexpected_response");
  }
  // Only copy the public contract. Never retain an unexpected secret field in app state.
  return {
    provider: value.provider,
    enabled: value.enabled,
    model: value.model,
    ...(value.provider === "ollama" && typeof value.baseUrl === "string"
      ? { baseUrl: value.baseUrl }
      : {}),
    hasApiKey: value.hasApiKey,
    selectable: value.selectable,
    configurationIssues: [...value.configurationIssues] as ConfigurationIssue[],
  };
}

/**
 * Sends a request to the provider settings API.
 * @param path The API path to request.
 * @param signal Optional AbortSignal to cancel the request.
 * @param body Optional request body for PATCH requests.
 * @returns The parsed JSON response.
 * @throws ProviderSettingsApiError if the request fails or the response is invalid.
 */
async function request(
  path: string,
  signal?: AbortSignal,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/settings/ai${path}`, {
      method: body === undefined ? "GET" : "PATCH",
      headers: {
        "x-receipt-tracker-settings": "1",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      cache: "no-store",
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    if (signal?.aborted) throw new DOMException("", "AbortError");
    throw new ProviderSettingsApiError("network_error");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderSettingsApiError("unexpected_response");
  }
  if (!response.ok) {
    const code =
      isRecord(payload) && errorCodes.find((code) => code === payload.error);
    throw new ProviderSettingsApiError(code || "unexpected_response");
  }
  return payload;
}

/**
 * Fetches the current provider settings from the API.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns The AI settings including the list of providers and the default provider.
 * @throws ProviderSettingsApiError if the request fails or the response is invalid.
 */
export async function getProviderSettings(
  signal?: AbortSignal,
): Promise<AiSettings> {
  const payload = await request("", signal);
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.providers) ||
    (payload.defaultProvider !== null && !isProvider(payload.defaultProvider))
  ) {
    throw new ProviderSettingsApiError("unexpected_response");
  }
  const providers = payload.providers.map(publicProvider);
  if (
    providers.length !== providerIds.length ||
    !providerIds.every(
      (id) =>
        providers.filter((provider) => provider.provider === id).length === 1,
    )
  ) {
    throw new ProviderSettingsApiError("unexpected_response");
  }
  return { providers, defaultProvider: payload.defaultProvider };
}

/**
 * Updates the settings for a specific provider.
 * @param provider The ID of the provider to update.
 * @param update The update to apply to the provider's settings.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns The updated provider settings.
 * @throws ProviderSettingsApiError if the request fails or the response is invalid.
 */
export async function updateProviderSettings(
  provider: ProviderId,
  update: ProviderUpdate,
  signal?: AbortSignal,
): Promise<ProviderSettings> {
  const result = publicProvider(
    await request(`/providers/${provider}`, signal, update),
  );
  if (result.provider !== provider)
    throw new ProviderSettingsApiError("unexpected_response");
  return result;
}

/**
 * Updates the default provider setting.
 * @param provider The ID of the provider to set as default, or null to unset.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns The updated default provider ID, or null if unset.
 * @throws ProviderSettingsApiError if the request fails or the response is invalid.
 */
export async function updateDefaultProvider(
  provider: ProviderId | null,
  signal?: AbortSignal,
): Promise<ProviderId | null> {
  const payload = await request("/default-provider", signal, { provider });
  if (!isRecord(payload) || payload.defaultProvider !== provider) {
    throw new ProviderSettingsApiError("unexpected_response");
  }
  return provider;
}
