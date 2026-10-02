import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createReceiptExtractionProviderFromEnv } from "../src/extraction/create-provider.js";
import { MistralProvider } from "../src/extraction/mistral-provider.js";
import { OllamaProvider } from "../src/extraction/ollama-provider.js";

const input = { plainText: "", lines: [], rows: [], categoryNames: ["food"] };
const mistralEnv = {
  LLM_PROVIDER: "mistral",
  MISTRAL_MODEL: "test-mistral-model",
  MISTRAL_API_KEY: "test-only-key",
};

// Tests for the createReceiptExtractionProviderFromEnv function
test("defaults to Ollama and preserves its configured endpoint, model, and request settings", async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init: RequestInit) => {
      calls++;
      assert.equal(url, "http://127.0.0.1:9999/api/chat");
      const body = JSON.parse(String(init.body));
      assert.equal(body.model, "test-ollama-model");
      assert.equal(body.think, true);
      assert.deepEqual(body.options, { temperature: 0 });
      assert.equal("authorization" in (init.headers ?? {}), false);
      return Response.json({ message: { content: '{"items":[]}' } });
    },
  );
  for (const LLM_PROVIDER of [undefined, "ollama", " ollama "]) {
    const provider = createReceiptExtractionProviderFromEnv({
      LLM_PROVIDER,
      OLLAMA_MODEL: " test-ollama-model ",
      OLLAMA_BASE_URL: "http://127.0.0.1:9999",
      MISTRAL_BASE_URL: "invalid ignored URL",
    });
    assert.ok(provider instanceof OllamaProvider);
    assert.deepEqual(await provider.extractReceipt(input), { items: [] });
  }
  assert.equal(calls, 3);
  assert.throws(() => createReceiptExtractionProviderFromEnv({}), {
    message: "OLLAMA_MODEL must name an installed Ollama model",
  });
});

// Additional tests for edge cases and error handling can be added below.
test("configures Mistral using only Mistral variables and preserves base URL paths", async (t) => {
  const cases = [
    { base: undefined, endpoint: "https://api.mistral.ai/v1/chat/completions" },
    {
      base: "https://mistral.example.test/v1",
      endpoint: "https://mistral.example.test/v1/chat/completions",
    },
    {
      base: "https://mistral.example.test/proxy/v1/",
      endpoint: "https://mistral.example.test/proxy/v1/chat/completions",
    },
    {
      base: "http://127.0.0.1:9999/v1/",
      endpoint: "http://127.0.0.1:9999/v1/chat/completions",
    },
  ];
  let expectedEndpoint: string;
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: unknown, init: RequestInit) => {
      calls++;
      assert.equal(url, expectedEndpoint);
      assert.equal(JSON.parse(String(init.body)).model, "test-mistral-model");
      assert.deepEqual(init.headers, {
        "content-type": "application/json",
        authorization: "Bearer test-only-key",
      });
      return Response.json({
        choices: [
          { finish_reason: "stop", message: { content: '{"items":[]}' } },
        ],
      });
    },
  );
  for (const entry of cases) {
    expectedEndpoint = entry.endpoint;
    const provider = createReceiptExtractionProviderFromEnv({
      LLM_PROVIDER: " mistral ",
      MISTRAL_MODEL: " test-mistral-model ",
      MISTRAL_API_KEY: " test-only-key ",
      MISTRAL_BASE_URL: entry.base,
      OLLAMA_BASE_URL: "invalid ignored URL",
    });
    assert.ok(provider instanceof MistralProvider);
    assert.deepEqual(await provider.extractReceipt(input), { items: [] });
  }
  assert.equal(calls, cases.length);
});

// Tests for error handling when environment variables are missing or invalid
test("rejects unsupported providers, missing models and keys, and invalid URLs without exposing values", () => {
  for (const LLM_PROVIDER of ["", "openai", "anthropic", "test-only-secret"]) {
    assert.throws(
      () =>
        createReceiptExtractionProviderFromEnv({ ...mistralEnv, LLM_PROVIDER }),
      {
        message: "LLM_PROVIDER must be ollama or mistral",
      },
    );
  }
  for (const MISTRAL_MODEL of [undefined, "", " "]) {
    assert.throws(
      () =>
        createReceiptExtractionProviderFromEnv({
          ...mistralEnv,
          MISTRAL_MODEL,
        }),
      {
        message: "MISTRAL_MODEL must name a Mistral model",
      },
    );
  }
  for (const MISTRAL_API_KEY of [undefined, "", " "]) {
    assert.throws(
      () =>
        createReceiptExtractionProviderFromEnv({
          ...mistralEnv,
          MISTRAL_API_KEY,
        }),
      {
        message: "MISTRAL_API_KEY must be set for the Mistral provider",
      },
    );
  }
  for (const MISTRAL_BASE_URL of [
    "",
    "test-only-secret",
    "file:///tmp/test-only-secret",
    "ftp://example.test",
    "https://test-only-secret@example.test/v1/",
    "https://example.test/v1/?key=test-only-secret",
    "https://example.test/v1/#test-only-secret",
  ]) {
    assert.throws(
      () =>
        createReceiptExtractionProviderFromEnv({
          ...mistralEnv,
          MISTRAL_BASE_URL,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith("MISTRAL_BASE_URL must be"));
        assert.equal(error.message.includes("test-only-secret"), false);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

// Tests for backend startup behavior with invalid Mistral configuration
test("invalid Mistral configuration stops backend startup before migration without logging secrets", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-provider-startup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const invalid of [
    { MISTRAL_API_KEY: "" },
    { MISTRAL_BASE_URL: "https://test-only-secret@example.test/v1/" },
  ]) {
    const logFile = join(directory, `backend-${Object.keys(invalid)[0]}.log`);
    const databaseFile = join(directory, "unused.sqlite");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          ...mistralEnv,
          MISTRAL_BASE_URL: "https://mistral.example.test/v1/",
          ...invalid,
          DATABASE_FILE: databaseFile,
          LOG_FILE: logFile,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.ok(
      result.stderr.includes("Backend startup failed during configuration"),
    );
    assert.equal(existsSync(databaseFile), false);
    const log = readFileSync(logFile, "utf8");
    const events = log
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      events.some(
        (event) =>
          event.operation === "backend.start.failed" &&
          event.phase === "configuration",
      ),
    );
    for (const secret of ["test-only-secret", "test-only-key"]) {
      assert.equal(
        (log + result.stderr + result.stdout).includes(secret),
        false,
      );
    }
  }
});
