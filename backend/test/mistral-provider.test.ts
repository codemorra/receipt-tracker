import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "../src/extraction/extraction-errors.js";
import { MistralProvider } from "../src/extraction/mistral-provider.js";
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
const endpoint = "https://mistral.example.test/custom/chat/completions";
const apiKey = "test-only-api-key";

// Helper function to create a mock completion response for the Mistral API
function completion(content: unknown = JSON.stringify(extraction)) {
  return {
    choices: [
      { finish_reason: "stop", message: { role: "assistant", content } },
    ],
    usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
  };
}

// Tests for the MistralProvider class
test("sends the shared prompt and Zod JSON schema to the configured model and endpoint", async (t) => {
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, "timeout", (delay: number) => {
    assert.equal(delay, 240_000);
    return signal;
  });
  let calls = 0;
  const provider = new MistralProvider(
    endpoint,
    "configured-model",
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
        model: "configured-model",
        messages: [
          { role: "user", content: createReceiptExtractionPrompt(input) },
        ],
        temperature: 0,
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
    model: "configured-model",
    inputTokens: 123,
    outputTokens: 45,
    totalTokens: 168,
  });
  assert.deepEqual(
    createReceiptExtractionSchema(input.categoryNames, [7]).parse(extraction),
    extraction,
  );
});

// Tests for the MistralProvider class continued
test("supports structured JSON returned as text chunks", async () => {
  const text = JSON.stringify(extraction);
  const provider = new MistralProvider(
    endpoint,
    "test-model",
    apiKey,
    async () =>
      Response.json(
        completion([
          { type: "text", text: text.slice(0, 20) },
          { type: "text", text: text.slice(20) },
        ]),
      ),
  );
  assert.deepEqual(await provider.extractReceipt(input), extraction);
});

// Additional tests for edge cases and error handling
test("requires a nonempty API key", () => {
  for (const key of ["", "   "]) {
    assert.throws(() => new MistralProvider(endpoint, "test-model", key), {
      message: "MISTRAL_API_KEY must be set for the Mistral provider",
    });
  }
});

// Tests for handling optional usage and malformed token counts
test("keeps optional usage absent and ignores malformed token counts", async () => {
  for (const usage of [
    undefined,
    null,
    "invalid",
    { prompt_tokens: -1, completion_tokens: 1.5, total_tokens: "168" },
    {
      prompt_tokens: Number.MAX_SAFE_INTEGER + 1,
      completion_tokens: null,
      total_tokens: [],
    },
  ]) {
    let diagnostics: ReceiptExtractionDiagnostics | undefined;
    const provider = new MistralProvider(
      endpoint,
      "test-model",
      apiKey,
      async () => Response.json({ ...completion(), usage }),
    );
    assert.deepEqual(
      await provider.extractReceipt(input, (value) => {
        diagnostics = value;
      }),
      extraction,
    );
    assert.deepEqual(diagnostics, {
      provider: "mistral",
      model: "test-model",
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  }
  let diagnostics: ReceiptExtractionDiagnostics | undefined;
  const provider = new MistralProvider(
    endpoint,
    "test-model",
    apiKey,
    async () =>
      Response.json({
        ...completion(),
        usage: { prompt_tokens: 0, completion_tokens: 45 },
      }),
  );
  await provider.extractReceipt(input, (value) => {
    diagnostics = value;
  });
  assert.equal(diagnostics?.inputTokens, 0);
  assert.equal(diagnostics?.outputTokens, 45);
  assert.equal(diagnostics?.totalTokens, undefined);
});

// Tests for handling HTTP failures and connection issues
test("classifies HTTP failures without exposing provider bodies or retrying", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    const provider = new MistralProvider(
      endpoint,
      "test-model",
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

// Tests for handling connection failures and request timeouts
test("classifies connection failures and request timeouts without copying transport errors", async () => {
  for (const failure of [
    new TypeError(apiKey),
    new DOMException(apiKey, "TimeoutError"),
    new DOMException(apiKey, "AbortError"),
  ]) {
    const provider = new MistralProvider(
      endpoint,
      "test-model",
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

// Tests for applying the timeout while reading the response body
test("applies the timeout while reading the response body", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", () => controller.signal);
  const response = new Response();
  t.mock.method(response, "json", async () => {
    controller.abort();
    throw new Error(apiKey);
  });
  const provider = new MistralProvider(
    endpoint,
    "test-model",
    apiKey,
    async () => response,
  );
  await assert.rejects(provider.extractReceipt(input), LlmUnavailableError);
});

// Tests for rejecting malformed envelopes, unfinished completions, and non-JSON content
test("rejects malformed envelopes, unfinished completions, and non-JSON content", async () => {
  const malformed = [
    "not JSON",
    "null",
    "{}",
    JSON.stringify({ choices: [] }),
    JSON.stringify(completion(null)),
    JSON.stringify(completion(123)),
    JSON.stringify(completion([])),
    JSON.stringify(completion([{ type: "image_url", image_url: "private" }])),
    JSON.stringify(completion("```json\n{}\n```")),
    JSON.stringify(completion("{")),
    ...["length", "model_length", "tool_calls", "error", null].map(
      (finish_reason) =>
        JSON.stringify({
          choices: [
            {
              finish_reason,
              message: {
                role: "assistant",
                content: JSON.stringify(extraction),
              },
            },
          ],
        }),
    ),
  ];
  for (const body of malformed) {
    const provider = new MistralProvider(
      endpoint,
      "test-model",
      apiKey,
      async () => new Response(body),
    );
    await assert.rejects(provider.extractReceipt(input), (error: unknown) => {
      assert.ok(error instanceof InvalidLlmResponseError);
      assert.equal(error.message.includes(body), false);
      return true;
    });
  }
});

// Tests for leaving receipt validation to the existing Zod validation after transport parsing
test("leaves receipt validation to the existing Zod validation after transport parsing", async () => {
  const invalid = { ...extraction, purchaseTime: "25:99" };
  const provider = new MistralProvider(
    endpoint,
    "test-model",
    apiKey,
    async () => Response.json(completion(JSON.stringify(invalid))),
  );
  const result = await provider.extractReceipt(input);
  assert.deepEqual(result, invalid);
  assert.throws(
    () => createReceiptExtractionSchema(input.categoryNames, [7]).parse(result),
    z.ZodError,
  );
});
