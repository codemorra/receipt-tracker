import { z } from "zod";
import { createReceiptExtractionSchema } from "./receipt-extraction.js";
import type {
  ReceiptExtractionInput,
  ReceiptExtractionProvider,
} from "./receipt-extraction-provider.js";
import { createReceiptExtractionPrompt } from "./receipt-extraction-prompt.js";

export class OllamaUnavailableError extends Error {}
export class OllamaRequestError extends Error {}
export class InvalidLlmResponseError extends Error {}

// Provider implementation for interacting with the Ollama LLM for receipt extraction.
export class OllamaProvider implements ReceiptExtractionProvider {
  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  // Extracts receipt data from the Ollama LLM using the provided input.
  async extractReceipt(input: ReceiptExtractionInput): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "user", content: createReceiptExtractionPrompt(input) },
          ],
          format: z.toJSONSchema(
            createReceiptExtractionSchema(input.categoryNames),
          ),
          stream: false,
          options: { temperature: 0 },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new OllamaUnavailableError("Ollama is unavailable or timed out");
    }

    if (!response.ok) {
      throw new OllamaRequestError(`Ollama returned HTTP ${response.status}`);
    }

    // Attempt to parse the response payload as JSON.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new InvalidLlmResponseError(
        "Ollama returned invalid response JSON",
      );
    }

    // Validate the structure of the Ollama response before attempting to parse it.
    if (
      !payload ||
      typeof payload !== "object" ||
      !("message" in payload) ||
      !payload.message ||
      typeof payload.message !== "object" ||
      !("content" in payload.message) ||
      typeof payload.message.content !== "string"
    ) {
      throw new InvalidLlmResponseError(
        "Ollama response has no message content",
      );
    }

    // Attempt to parse the message content as JSON.
    try {
      return JSON.parse(payload.message.content) as unknown;
    } catch {
      throw new InvalidLlmResponseError(
        "Ollama returned invalid extraction JSON",
      );
    }
  }
}

/**
 * Creates an OllamaProvider instance using environment variables.
 * @param env The environment variables object (defaults to process.env).
 * @returns An OllamaProvider instance configured with the specified environment variables.
 */
export function createOllamaProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OllamaProvider {
  const model = env.OLLAMA_MODEL?.trim();
  if (!model) {
    throw new Error("OLLAMA_MODEL must name an installed Ollama model");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
  } catch {
    throw new Error("OLLAMA_BASE_URL must be a valid HTTP URL");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must be a valid HTTP URL");
  }

  return new OllamaProvider(new URL("/api/chat", baseUrl).toString(), model);
}
