import { z } from "zod";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "./extraction-errors.js";
import { openaiExtractionProfile } from "./extraction-profile.js";
import { createReceiptExtractionPrompt } from "./receipt-extraction-prompt.js";
import type {
  ReceiptExtractionDiagnostics,
  ReceiptExtractionInput,
  ReceiptExtractionProvider,
} from "./receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "./receipt-extraction.js";

const responseSchema = z.object({
  status: z.literal("completed"),
  error: z.null().optional(),
  output: z.array(z.object({ type: z.string() }).passthrough()),
  usage: z.unknown().optional(),
});

const finalMessageSchema = z.object({
  type: z.literal("message"),
  role: z.literal("assistant"),
  status: z.literal("completed"),
  phase: z.literal("final_answer").nullable().optional(),
  content: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("output_text"), text: z.string() }),
        z.object({ type: z.literal("refusal"), refusal: z.string() }),
      ]),
    )
    .min(1),
});

// Returns the value if it is a non-negative safe integer, otherwise undefined.
function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

// OpenAI provider implementation for receipt extraction.
export class OpenAiProvider implements ReceiptExtractionProvider {
  private readonly apiKey: string;

  constructor(
    private readonly model: string,
    apiKey: string,
    private readonly request: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey.trim();
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY must be set for the OpenAI provider");
    }
  }

  // Extracts receipt information using the OpenAI API.
  async extractReceipt(
    input: ReceiptExtractionInput,
    onDiagnostics?: (diagnostics: ReceiptExtractionDiagnostics) => void,
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(openaiExtractionProfile.timeoutMs);
    const body = JSON.stringify({
      model: this.model,
      reasoning: { effort: openaiExtractionProfile.reasoningEffort },
      input: createReceiptExtractionPrompt(input),
      store: false,
      stream: false,
      text: {
        format: {
          type: "json_schema",
          name: "receipt_extraction",
          strict: true,
          schema: z.toJSONSchema(
            createReceiptExtractionSchema(input.categoryNames),
          ),
        },
      },
    });

    let response: Response;
    try {
      response = await this.request("https://api.openai.com/v1/responses", {
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
        "openai",
        "OpenAI is unavailable or timed out",
      );
    }

    if (!response.ok) {
      throw new LlmRequestError(
        "openai",
        `OpenAI returned HTTP ${response.status}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException &&
          (error.name === "TimeoutError" || error.name === "AbortError"))
      ) {
        throw new LlmUnavailableError(
          "openai",
          "OpenAI is unavailable or timed out",
        );
      }
      throw new InvalidLlmResponseError(
        "OpenAI returned invalid response JSON",
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new InvalidLlmResponseError(
        "OpenAI returned an invalid or incomplete response",
      );
    }

    const usage = parsed.data.usage;
    const counts =
      usage && typeof usage === "object"
        ? (usage as Record<string, unknown>)
        : {};
    onDiagnostics?.({
      provider: "openai",
      model: this.model,
      inputTokens: tokenCount(counts.input_tokens),
      outputTokens: tokenCount(counts.output_tokens),
      totalTokens: tokenCount(counts.total_tokens),
    });

    const messages = z
      .array(finalMessageSchema)
      .length(1)
      .safeParse(
        parsed.data.output.filter(
          (item) => item.type === "message" && item.phase !== "commentary",
        ),
      );
    if (!messages.success) {
      throw new InvalidLlmResponseError(
        "OpenAI returned no valid final message",
      );
    }
    const content = messages.data[0].content;
    if (content.some((chunk) => chunk.type === "refusal")) {
      throw new InvalidLlmResponseError("OpenAI refused receipt extraction");
    }
    const text = content
      .filter((chunk) => chunk.type === "output_text")
      .map((chunk) => chunk.text)
      .join("");
    if (!text.trim()) {
      throw new InvalidLlmResponseError("OpenAI returned no final text output");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new InvalidLlmResponseError(
        "OpenAI returned invalid extraction JSON",
      );
    }
  }
}
