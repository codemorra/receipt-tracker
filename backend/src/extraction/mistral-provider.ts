import { z } from "zod";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "./extraction-errors.js";
import { mistralExtractionProfile } from "./extraction-profile.js";
import { createReceiptExtractionPrompt } from "./receipt-extraction-prompt.js";
import type {
  ReceiptExtractionDiagnostics,
  ReceiptExtractionInput,
  ReceiptExtractionProvider,
} from "./receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "./receipt-extraction.js";

// Response schema for the Mistral LLM provider
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.literal("stop"),
        message: z.object({
          role: z.literal("assistant").optional(),
          content: z.union([
            z.string(),
            z
              .array(z.object({ type: z.literal("text"), text: z.string() }))
              .min(1),
          ]),
        }),
      }),
    )
    .length(1),
  usage: z.unknown().optional(),
});

// Helper function to safely extract token counts from the Mistral usage object
function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// MistralProvider implements the ReceiptExtractionProvider interface using the Mistral LLM provider
export class MistralProvider implements ReceiptExtractionProvider {
  private readonly apiKey: string;

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey.trim();
    if (!this.apiKey) {
      throw new Error("MISTRAL_API_KEY must be set for the Mistral provider");
    }
  }

  // Extracts a receipt using the Mistral LLM provider
  async extractReceipt(
    input: ReceiptExtractionInput,
    onDiagnostics?: (diagnostics: ReceiptExtractionDiagnostics) => void,
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(mistralExtractionProfile.timeoutMs);
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: mistralExtractionProfile.instructions },
        { role: "user", content: createReceiptExtractionPrompt(input) },
      ],
      temperature: mistralExtractionProfile.temperature,
      random_seed: mistralExtractionProfile.randomSeed,
      stream: false,
      response_format: {
        type: mistralExtractionProfile.responseFormat,
        json_schema: {
          name: "receipt_extraction",
          strict: true,
          schema: z.toJSONSchema(
            createReceiptExtractionSchema(input.categoryNames),
          ),
        },
      },
    });

    let response: Response;

    // Send the request to the Mistral API and handle potential errors
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        redirect: "error",
        signal,
      });
    } catch {
      throw new LlmUnavailableError(
        "mistral",
        "Mistral is unavailable or timed out",
      );
    }

    // Check if the response indicates an error before attempting to parse it
    if (!response.ok) {
      throw new LlmRequestError(
        "mistral",
        `Mistral returned HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: unknown;

    // Attempt to parse the response JSON
    try {
      payload = await response.json();
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException &&
          (error.name === "TimeoutError" || error.name === "AbortError"))
      ) {
        throw new LlmUnavailableError(
          "mistral",
          "Mistral is unavailable or timed out",
        );
      }
      throw new InvalidLlmResponseError(
        "Mistral returned invalid response JSON",
      );
    }

    // Validate the response against the expected schema
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new InvalidLlmResponseError(
        "Mistral returned an invalid or incomplete completion",
      );
    }

    // Extract and report token usage for diagnostics
    const usage = parsed.data.usage;
    const counts =
      usage && typeof usage === "object"
        ? (usage as Record<string, unknown>)
        : {};
    onDiagnostics?.({
      provider: "mistral",
      model: this.model,
      inputTokens: tokenCount(counts.prompt_tokens),
      outputTokens: tokenCount(counts.completion_tokens),
      totalTokens: tokenCount(counts.total_tokens),
    });

    // Extract the content of the first choice and parse it as JSON
    const content = parsed.data.choices[0].message.content;
    const text =
      typeof content === "string"
        ? content
        : content.map((chunk) => chunk.text).join("");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new InvalidLlmResponseError(
        "Mistral returned invalid extraction JSON",
      );
    }
  }
}
