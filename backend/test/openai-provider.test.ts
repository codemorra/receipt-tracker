import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { InvalidLlmResponseError } from "../src/extraction/extraction-errors.js";
import { OpenAiProvider } from "../src/extraction/openai-provider.js";
import { createReceiptExtractionPrompt } from "../src/extraction/receipt-extraction-prompt.js";
import type { ReceiptExtractionDiagnostics } from "../src/extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "../src/extraction/receipt-extraction.js";

const input = {
  plainText: "private plain text",
  lines: [{ index: 7, text: "TEST SHOP" }],
  rows: [
    { rowIndex: 0, segments: [{ text: "TEST SHOP", x: 0 }], lineIndexes: [7] },
  ],
  categoryNames: ["food"],
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
const finalMessage = {
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text: JSON.stringify(extraction) }],
};
const completion = (output: unknown[] = [finalMessage]) => ({
  status: "completed",
  output,
  usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 },
});

// Test for the OpenAiProvider extracting a receipt with diagnostics
test("sends a stateless structured receipt request and returns final JSON with diagnostics", async () => {
  let calls = 0;
  const provider = new OpenAiProvider(
    "test-model",
    "test-only-key",
    async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.method, "POST");
      assert.deepEqual(init?.headers, {
        "content-type": "application/json",
        authorization: "Bearer test-only-key",
      });
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "test-model",
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
      return Response.json(completion());
    },
  );
  let diagnostics: ReceiptExtractionDiagnostics | undefined;
  assert.deepEqual(
    await provider.extractReceipt(input, (value) => {
      diagnostics = value;
    }),
    extraction,
  );
  assert.deepEqual(diagnostics, {
    provider: "openai",
    model: "test-model",
    inputTokens: 123,
    outputTokens: 45,
    totalTokens: 168,
  });
  assert.equal(calls, 1);
});

// Test for the OpenAiProvider ignoring reasoning and commentary messages
test("ignores reasoning and commentary when selecting the final receipt output", async () => {
  const decoy = JSON.stringify({ ...extraction, totalCents: 999 });
  const provider = new OpenAiProvider("test-model", "test-only-key", async () =>
    Response.json(
      completion([
        {
          type: "reasoning",
          content: [{ type: "output_text", text: decoy }],
          summary: [{ type: "summary_text", text: decoy }],
        },
        {
          ...finalMessage,
          phase: "commentary",
          content: [{ type: "output_text", text: decoy }],
        },
        { ...finalMessage, phase: "final_answer" },
      ]),
    ),
  );
  assert.deepEqual(await provider.extractReceipt(input), extraction);
});

// Test for the OpenAiProvider rejecting a refusal message even if valid JSON is present
test("rejects an OpenAI refusal even alongside valid JSON without exposing its contents", async () => {
  const provider = new OpenAiProvider("test-model", "test-only-key", async () =>
    Response.json(
      completion([
        {
          ...finalMessage,
          content: [
            ...finalMessage.content,
            { type: "refusal", refusal: "test-only-key private refusal" },
          ],
        },
      ]),
    ),
  );
  await assert.rejects(provider.extractReceipt(input), (error: unknown) => {
    assert.ok(error instanceof InvalidLlmResponseError);
    assert.equal(error.message, "OpenAI refused receipt extraction");
    return true;
  });
});
