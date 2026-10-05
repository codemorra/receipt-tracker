import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "../src/extraction/extraction-errors.js";
import { MistralProvider } from "../src/extraction/mistral-provider.js";
import { mistralExtractionProfile } from "../src/extraction/extraction-profile.js";
import { createReceiptExtractionPrompt } from "../src/extraction/receipt-extraction-prompt.js";
import type { ReceiptExtractionDiagnostics } from "../src/extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "../src/extraction/receipt-extraction.js";

const input = {
  plainText: "private plain text",
  lines: [{ index: 7, text: "TEST SHOP" }],
  rows: [
    { rowIndex: 0, segments: [{ text: "TEST SHOP", x: 0 }], lineIndexes: [7] },
  ],
  categoryNames: ["food", "custom"],
};
const extraction = {
  merchant: { rawName: "TEST SHOP", normalizedName: "Test Shop" },
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  currency: "EUR",
  totalCents: 0,
  items: [],
  discounts: [],
};
const endpoint = "https://api.mistral.ai/v1/chat/completions";
const apiKey = "test-only-api-key";

// Simulates the Mistral provider's API responses for testing purposes.
function completion(
  content: unknown = JSON.stringify(extraction),
  finishReason = "stop",
) {
  return {
    choices: [
      { finish_reason: finishReason, message: { role: "assistant", content } },
    ],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  };
}

// Tests for the Mistral provider's request construction and response handling.
test("sends the Medium profile, shared prompt and Zod JSON schema to the configured endpoint", async (t) => {
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, "timeout", (delay: number) => {
    assert.equal(delay, 240_000);
    return signal;
  });
  let calls = 0;
  const provider = new MistralProvider(
    "mistral-medium-latest",
    apiKey,
    async (url, init) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(init?.method, "POST");
      assert.equal(init?.signal, signal);
      assert.equal(init?.redirect, "error");
      assert.deepEqual(init?.headers, {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      });
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "mistral-medium-latest",
        messages: [
          {
            role: "system",
            content: mistralExtractionProfile.instructions,
          },
          { role: "user", content: createReceiptExtractionPrompt(input) },
        ],
        temperature: 0,
        random_seed: 42,
        top_p: 1,
        reasoning_effort: "high",
        stream: false,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "receipt_extraction",
            strict: true,
            schema: z.toJSONSchema(
              createReceiptExtractionSchema(input.categoryNames),
            ),
          },
        },
      });
      assert.equal(String(init?.body).includes(apiKey), false);
      assert.equal(String(init?.body).includes(input.plainText), false);
      return Response.json({
        ...completion(),
        model: "resolved-model-version",
      });
    },
  );
  let diagnostics: ReceiptExtractionDiagnostics | undefined;
  assert.deepEqual(
    await provider.extractReceipt(input, (value) => {
      diagnostics = value;
    }),
    extraction,
  );
  assert.equal(calls, 1);
  assert.deepEqual(diagnostics, {
    provider: "mistral",
    model: "mistral-medium-latest",
    inputTokens: 123,
    outputTokens: 45,
    totalTokens: 168,
  });
});

// Tests for the Mistral provider's handling of streaming responses and structured text chunks.
test("reads final structured text chunks while ignoring thinking", async () => {
  const text = JSON.stringify(extraction);
  const provider = new MistralProvider(
    "mistral-medium-latest",
    apiKey,
    async () =>
      Response.json(
        completion([
          {
            type: "thinking",
            thinking: [
              {
                type: "text",
                text: JSON.stringify({ ...extraction, totalCents: 999 }),
              },
            ],
          },
          { type: "text", text: text.slice(0, 20) },
          { type: "text", text: text.slice(20) },
        ]),
      ),
  );
  assert.deepEqual(await provider.extractReceipt(input), extraction);
});

// Tests for the Mistral provider's handling of discount indexes in receipt items.
test("preserves zero and full-array discount indexes through parsing and validation", async () => {
  const receipt = {
    ...extraction,
    items: ["product", "deposit", "fee", "other"].map((lineType) => ({
      rawName: lineType,
      normalizedName: null,
      brand: null,
      productGroup: null,
      category: null,
      packageAmount: null,
      packageUnit: null,
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 25,
      totalPriceCents: 25,
      lineType,
      sourceLineIndexes: [7],
    })),
    discounts: [0, 1, 2, 3, null].map((appliesToItemIndex) => ({
      rawName: "Discount",
      description: null,
      amountCents: 1,
      appliesToItemIndex,
      sourceLineIndexes: [7],
    })),
    totalCents: 95,
  };
  const provider = new MistralProvider(
    "mistral-medium-latest",
    apiKey,
    async () => Response.json(completion(JSON.stringify(receipt))),
  );
  const parsed = createReceiptExtractionSchema(input.categoryNames, [7]).parse(
    await provider.extractReceipt(input),
  );
  assert.deepEqual(parsed, receipt);
});

// Tests for the Mistral provider's API key validation.
test("requires a nonempty API key", () => {
  for (const key of ["", "   "]) {
    assert.throws(() => new MistralProvider("mistral-medium-latest", key), {
      message: "An API key is required for the Mistral provider",
    });
  }
});

// Tests for the Mistral provider's handling of usage diagnostics, including missing, invalid, and zero values.
test("accepts missing usage, ignores invalid counts, and preserves zero", async () => {
  const cases = [
    { usage: undefined, inputTokens: undefined, outputTokens: undefined },
    {
      usage: { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "168" },
      inputTokens: undefined,
      outputTokens: undefined,
    },
    {
      usage: { prompt_tokens: 0, completion_tokens: 45 },
      inputTokens: 0,
      outputTokens: 45,
    },
  ];
  for (const entry of cases) {
    let diagnostics: ReceiptExtractionDiagnostics | undefined;
    const provider = new MistralProvider(
      "mistral-medium-latest",
      apiKey,
      async () => Response.json({ ...completion(), usage: entry.usage }),
    );
    assert.deepEqual(
      await provider.extractReceipt(input, (value) => {
        diagnostics = value;
      }),
      extraction,
    );
    assert.deepEqual(diagnostics, {
      provider: "mistral",
      model: "mistral-medium-latest",
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: undefined,
    });
  }
});

// Tests for the Mistral provider's handling of HTTP failures, ensuring that provider response bodies are not exposed and requests are not retried.
test("classifies HTTP failures without exposing provider bodies or retrying", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const provider = new MistralProvider(
      "mistral-medium-latest",
      apiKey,
      async () => {
        calls++;
        return new Response(`${apiKey} private response text`, { status });
      },
    );
    await assert.rejects(provider.extractReceipt(input), (error: unknown) => {
      assert.ok(error instanceof LlmRequestError);
      assert.equal(error.provider, "mistral");
      assert.equal(error.httpStatus, status);
      assert.equal(error.message, `Mistral returned HTTP ${status}`);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(calls, 1);
  }
});

// Tests for the Mistral provider's handling of connection failures and request timeouts, ensuring transport errors are not copied.
test("classifies connection failures and request timeouts without copying transport errors", async () => {
  for (const failure of [
    new TypeError(apiKey),
    new DOMException(apiKey, "TimeoutError"),
  ]) {
    const provider = new MistralProvider(
      "mistral-medium-latest",
      apiKey,
      async () => {
        throw failure;
      },
    );
    await assert.rejects(provider.extractReceipt(input), (error: unknown) => {
      assert.ok(error instanceof LlmUnavailableError);
      assert.equal(error.provider, "mistral");
      assert.equal(error.message, "Mistral is unavailable or timed out");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

// Tests for the Mistral provider's handling of response body read timeouts.
test("applies the timeout while reading the response body", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const response = new Response();
  t.mock.method(response, "json", async () => {
    controller.abort();
    throw new Error(apiKey);
  });
  const provider = new MistralProvider(
    "mistral-medium-latest",
    apiKey,
    async () => response,
  );
  await assert.rejects(provider.extractReceipt(input), LlmUnavailableError);
});

// Tests for the Mistral provider's handling of malformed envelopes, unfinished completions, and non-JSON content.
test("rejects malformed envelopes, unfinished completions, and non-JSON content", async () => {
  const malformed = [
    `${apiKey} invalid response JSON`,
    "{}",
    JSON.stringify(completion([{ type: "image_url", image_url: apiKey }])),
    JSON.stringify(completion(`${apiKey} invalid extraction JSON`)),
    JSON.stringify(completion(JSON.stringify(extraction), "length")),
  ];
  for (const body of malformed) {
    const provider = new MistralProvider(
      "mistral-medium-latest",
      apiKey,
      async () => new Response(body),
    );
    await assert.rejects(provider.extractReceipt(input), (error: unknown) => {
      assert.ok(error instanceof InvalidLlmResponseError);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    });
  }
});
