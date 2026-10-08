import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  InvalidLlmResponseError,
  OllamaProvider,
  OllamaRequestError,
  OllamaUnavailableError,
} from "../src/extraction/ollama-provider.js";
import { createReceiptExtractionPrompt } from "../src/extraction/receipt-extraction-prompt.js";
import { createQwenReceiptExtractionPrompt } from "../src/extraction/qwen-extraction-prompt.js";
import type { ReceiptExtractionDiagnostics } from "../src/extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "../src/extraction/receipt-extraction.js";

// Defines a sample input for receipt extraction tests.
const input = {
  plainText: "EDEKA\nMILCH 1L\n1,19",
  lines: [
    { index: 0, text: "EDEKA", confidence: 0.98, box: [0, 0, 1, 0.1] },
    { index: 1, text: "MILCH 1L" },
  ],
  rows: [
    { rowIndex: 0, segments: [{ text: "EDEKA", x: 0 }], lineIndexes: [0] },
    { rowIndex: 1, segments: [{ text: "MILCH 1L", x: 0.1 }], lineIndexes: [1] },
  ],
  categoryNames: ["food", "custom"],
};

// Tests for the OllamaProvider class and its interaction with receipt extraction prompts.
test("sends only OCR data and categories with the extraction JSON schema", async (t) => {
  const signal = new AbortController().signal;
  t.mock.method(AbortSignal, "timeout", (delay: number) => {
    assert.equal(delay, 240_000);
    return signal;
  });
  let requestBody: Record<string, unknown> | undefined;
  const provider = new OllamaProvider(
    "http://127.0.0.1:11434/api/chat",
    "test-model",
    async (url, init) => {
      assert.equal(url, "http://127.0.0.1:11434/api/chat");
      assert.equal(init?.method, "POST");
      assert.deepEqual(init?.headers, { "content-type": "application/json" });
      assert.equal(init?.signal, signal);
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ message: { content: '{"items":[]}' } }),
        { status: 200 },
      );
    },
  );

  assert.deepEqual(await provider.extractReceipt(input), { items: [] });
  assert.ok(requestBody);
  assert.deepEqual(requestBody, {
    model: "test-model",
    messages: [{ role: "user", content: createReceiptExtractionPrompt(input) }],
    format: z.toJSONSchema(createReceiptExtractionSchema(input.categoryNames)),
    stream: false,
    think: true,
    options: { temperature: 0 },
  });
  const format = requestBody.format as {
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  assert.ok(format.properties.items);
  assert.ok(format.properties.discounts);
  assert.equal(format.additionalProperties, false);
  assert.equal("warranty" in format.properties, false);

  const messages = requestBody.messages as { content: string }[];
  assert.ok(
    messages[0].content.includes('Current categories: ["food","custom"]'),
  );
  assert.equal(messages[0].content.includes('"plainText"'), false);
  assert.equal(messages[0].content.includes('"lines"'), false);
  assert.equal(messages[0].content.includes('"confidence"'), false);
  assert.equal(messages[0].content.includes('"box"'), false);
  assert.equal(messages[0].content.includes('"left"'), false);
  assert.equal(messages[0].content.includes("productAliases"), false);
  assert.equal(messages[0].content.includes("Private Merchant"), false);
  assert.ok(
    messages[0].content.includes('[0; x=0] "EDEKA"\n[1; x=0.1] "MILCH 1L"'),
  );
});

// Qwen-specific instructions must not change other models or the shared prompt.
test("extends only Qwen3.8 requests while preserving the base prompt and extraction settings", async () => {
  const originalInput = structuredClone(input);
  const basePrompt = createReceiptExtractionPrompt(input);
  const qwenPrompt = createQwenReceiptExtractionPrompt(input);
  assert.ok(qwenPrompt.startsWith(basePrompt + "\n\n"));
  assert.notEqual(qwenPrompt, basePrompt);

  for (const model of [
    "qwen3.8:27b",
    "qwen3.8",
    "qwen3:8b",
    "qwen3.8-other:27b",
  ]) {
    let requestBody: Record<string, unknown> | undefined;
    const provider = new OllamaProvider(
      "http://localhost/api/chat",
      model,
      async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({ message: { content: '{"items":[]}' } }),
        );
      },
    );
    await provider.extractReceipt(input);
    assert.deepEqual(requestBody, {
      model,
      messages: [
        {
          role: "user",
          content:
            model === "qwen3.8:27b" || model === "qwen3.8"
              ? qwenPrompt
              : basePrompt,
        },
      ],
      format: z.toJSONSchema(
        createReceiptExtractionSchema(input.categoryNames),
      ),
      stream: false,
      think: true,
      options: { temperature: 0 },
    });
  }
  assert.equal(createReceiptExtractionPrompt(input), basePrompt);
  assert.deepEqual(input, originalInput);
});

// Tests for the extraction of Ollama timing and token metadata.
test("extracts available Ollama timing and token metadata", async () => {
  const provider = new OllamaProvider(
    "http://localhost/api/chat",
    "test-model",
    async () =>
      new Response(
        JSON.stringify({
          message: { content: '{"items":[]}' },
          total_duration: 20_000_000_000,
          load_duration: 1_500_000_000,
          prompt_eval_count: 250,
          prompt_eval_duration: 3_000_000_000,
          eval_count: 40,
          eval_duration: 15_000_000_000,
        }),
      ),
  );
  let diagnostics: ReceiptExtractionDiagnostics | undefined;
  await provider.extractReceipt(input, (value) => {
    diagnostics = value;
  });
  assert.deepEqual(diagnostics, {
    provider: "ollama",
    model: "test-model",
    inputTokens: 250,
    outputTokens: 40,
    ollama: {
      model: "test-model",
      totalDurationMs: 20_000,
      loadDurationMs: 1_500,
      promptEvalCount: 250,
      promptEvalDurationMs: 3_000,
      evalCount: 40,
      evalDurationMs: 15_000,
    },
  });
});

// Tests for the receipt extraction prompt creation function.
test("prompt tells the model how to use unknown values and source indexes", () => {
  const prompt = createReceiptExtractionPrompt(input);
  assert.ok(prompt.includes("Use null for unknown or uncertain values"));
  assert.ok(
    prompt.includes(
      "Use YYYY-MM-DD for purchaseDate and HH:mm for purchaseTime",
    ),
  );
  assert.ok(
    prompt.includes(
      "packageAmount and packageUnit describe the size of one product package",
    ),
  );
  assert.ok(prompt.includes("Use lineType product, deposit, fee, or other"));
  assert.ok(
    prompt.includes("sourceLineIndexes refer to the original OCR line indexes"),
  );
  assert.ok(
    prompt.includes("appliesToItemIndex refers to a zero-based item position"),
  );
  assert.ok(
    prompt.includes("Do not include database IDs, aliases, warranty details"),
  );
});

// Tests for the classification of different types of Ollama request failures.
test("classifies transport, HTTP, envelope, and extraction JSON failures", async () => {
  const unavailable = new OllamaProvider(
    "http://localhost/api/chat",
    "test",
    async () => {
      throw new TypeError("connection refused");
    },
  );
  await assert.rejects(
    unavailable.extractReceipt(input),
    OllamaUnavailableError,
  );

  const rejected = new OllamaProvider(
    "http://localhost/api/chat",
    "test",
    async () => new Response("model not found", { status: 404 }),
  );
  await assert.rejects(rejected.extractReceipt(input), OllamaRequestError);

  for (const body of ["not JSON", "{}", '{"message":{"content":"{"}}']) {
    const malformed = new OllamaProvider(
      "http://localhost/api/chat",
      "test",
      async () => new Response(body, { status: 200 }),
    );
    await assert.rejects(
      malformed.extractReceipt(input),
      InvalidLlmResponseError,
    );
  }
});
