import { MistralProvider } from "./mistral-provider.js";
import { createOllamaProviderFromEnv } from "./ollama-provider.js";
import { OpenAiProvider } from "./openai-provider.js";
import type { ReceiptExtractionProvider } from "./receipt-extraction-provider.js";

/**
 * Creates a receipt extraction provider based on environment variables.
 * Supports "ollama", "mistral", and "openai" as LLM_PROVIDER values.
 * @param env - The environment variables to read from (defaults to process.env).
 * @returns A configured ReceiptExtractionProvider instance.
 * @throws If required environment variables are missing or invalid.
 */
export function createReceiptExtractionProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReceiptExtractionProvider {
  const provider = env.LLM_PROVIDER?.trim() ?? "ollama";
  if (provider === "ollama") return createOllamaProviderFromEnv(env);
  if (provider === "openai") {
    const model = env.OPENAI_MODEL?.trim();
    if (!model) throw new Error("OPENAI_MODEL must name an OpenAI model");
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY must be set for the OpenAI provider");
    }
    return new OpenAiProvider(model, apiKey);
  }
  if (provider !== "mistral") {
    throw new Error("LLM_PROVIDER must be ollama, mistral or openai");
  }

  const model = env.MISTRAL_MODEL?.trim();
  if (!model) throw new Error("MISTRAL_MODEL must name a Mistral model");
  const apiKey = env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY must be set for the Mistral provider");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1/");
  } catch {
    throw new Error("MISTRAL_BASE_URL must be a valid HTTP URL");
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      "MISTRAL_BASE_URL must be an HTTP URL without credentials, query, or fragment",
    );
  }
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";

  return new MistralProvider(
    new URL("chat/completions", baseUrl).toString(),
    model,
    apiKey,
  );
}
