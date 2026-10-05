import { MistralProvider } from "./mistral-provider.js";
import { OllamaProvider } from "./ollama-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import {
  normalizeOllamaBaseUrl,
  ProviderSettingsError,
} from "../settings/provider-settings.js";
import type {
  ProviderRuntimeConfiguration,
  ReceiptExtractionProvider,
} from "./receipt-extraction-provider.js";

/**
 * Creates exactly the configured provider, without reading ENV or trying alternatives.
 * @param configuration The runtime configuration for the provider.
 * @param request The fetch function to use for network requests.
 * @returns An instance of the configured receipt extraction provider.
 */
export function createReceiptExtractionProvider(
  configuration: ProviderRuntimeConfiguration,
  request: typeof fetch = fetch,
): ReceiptExtractionProvider {
  const model = configuration.model.trim();
  if (!model)
    throw new ProviderSettingsError("provider_configuration_incomplete");
  if (configuration.provider === "ollama") {
    const baseUrl = normalizeOllamaBaseUrl(configuration.baseUrl);
    return new OllamaProvider(
      new URL("api/chat", `${baseUrl}/`).toString(),
      model,
      request,
    );
  }
  if (!configuration.apiKey.trim())
    throw new ProviderSettingsError("provider_configuration_incomplete");
  if (configuration.provider === "mistral")
    return new MistralProvider(model, configuration.apiKey, request);
  if (configuration.provider === "openai")
    return new OpenAiProvider(model, configuration.apiKey, request);
  throw new ProviderSettingsError("invalid_provider");
}
