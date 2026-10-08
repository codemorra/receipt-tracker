import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createDatabase } from "../src/db/database.js";
import { createReceiptExtractionProvider } from "../src/extraction/create-provider.js";
import { createProviderResolver } from "../src/extraction/provider-resolver.js";
import { ProviderSettingsService } from "../src/settings/provider-settings-service.js";
import { SecretStorage } from "../src/settings/secret-storage.js";

const input = { plainText: "", lines: [], rows: [], categoryNames: ["food"] };

// Simulates the cloud provider responses for testing purposes.
function cloudResponse() {
  return Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "{}" }],
      },
    ],
  });
}

// Tests for the receipt extraction provider factory functions.
test("Ollama preserves configured hosts, ports, and base URL paths", async () => {
  for (const baseUrl of [
    "http://127.0.0.1:9999",
    "http://localhost:11434/proxy/ollama/",
  ]) {
    const expected = `${baseUrl.replace(/\/$/, "")}/api/chat`;
    const provider = createReceiptExtractionProvider(
      { provider: "ollama", model: " configured-model ", baseUrl },
      async (url, init) => {
        assert.equal(url, expected);
        assert.equal(JSON.parse(String(init?.body)).model, "configured-model");
        return Response.json({ message: { content: "{}" } });
      },
    );
    assert.deepEqual(await provider.extractReceipt(input), {});
  }
});

// Verify that cloud credentials are sent only to the official endpoint.
test("OpenAI uses its official endpoint and the configured model and key", async () => {
  const provider = createReceiptExtractionProvider(
    {
      provider: "openai",
      model: "configured-model",
      apiKey: " test-only-key ",
    },
    async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-only-key",
      );
      assert.equal(JSON.parse(String(init?.body)).model, "configured-model");
      assert.equal(init?.redirect, "error");
      return cloudResponse();
    },
  );
  assert.deepEqual(await provider.extractReceipt(input), {});
});

// Tests for the factory's handling of incomplete configurations and unsafe Ollama URLs.
test("factory rejects incomplete configuration and unsafe Ollama URLs without exposing values", () => {
  assert.throws(
    () =>
      createReceiptExtractionProvider({
        provider: "ollama",
        model: "",
        baseUrl: "http://localhost:11434",
      }),
    { code: "provider_configuration_incomplete" },
  );
  assert.throws(
    () =>
      createReceiptExtractionProvider({
        provider: "openai",
        model: "model",
        apiKey: " ",
      }),
    { code: "provider_configuration_incomplete" },
  );
  for (const baseUrl of [
    "file:///tmp/test-only-secret",
    "https://user:test-only-secret@example.com",
    "http://localhost/?key=test-only-secret",
  ]) {
    assert.throws(
      () =>
        createReceiptExtractionProvider({
          provider: "ollama",
          model: "model",
          baseUrl,
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(String(error).includes("test-only-secret"), false);
        return true;
      },
    );
  }
});

// Tests for the provider resolver's handling of default selections, invalid selections, and configuration snapshots.
test("resolver uses the persisted default, rejects explicit invalid selections, and snapshots configuration", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-resolver-"));
  const { db, sqlite } = createDatabase(":memory:");
  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const settings = new ProviderSettingsService(
    db,
    new SecretStorage(join(directory, "keys")),
  );
  const requests: {
    url: string;
    model: string;
    authorization: string | null;
  }[] = [];
  const resolver = createProviderResolver(settings, (configuration) =>
    createReceiptExtractionProvider(configuration, async (url, init) => {
      requests.push({
        url: String(url),
        model: JSON.parse(String(init?.body)).model,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return configuration.provider === "ollama"
        ? Response.json({ message: { content: "{}" } })
        : cloudResponse();
    }),
  );
  assert.throws(() => resolver(undefined), {
    code: "default_provider_missing",
  });
  settings.updateProvider("ollama", { enabled: true, model: "local-model" });
  settings.updateProvider("openai", {
    enabled: true,
    model: "old-model",
    apiKey: { action: "set", value: "old-key" },
  });
  settings.setDefaultProvider("ollama");
  const pending = resolver("openai");
  settings.updateProvider("openai", {
    model: "new-model",
    apiKey: { action: "set", value: "new-key" },
  });
  await pending.extractReceipt(input);
  await resolver("openai").extractReceipt(input);
  await resolver(undefined).extractReceipt(input);
  assert.deepEqual(
    requests.map(({ model, authorization }) => ({ model, authorization })),
    [
      { model: "old-model", authorization: "Bearer old-key" },
      { model: "new-model", authorization: "Bearer new-key" },
      { model: "local-model", authorization: null },
    ],
  );
  for (const selection of ["unknown", null, "", 123])
    assert.throws(() => resolver(selection), { code: "invalid_provider" });
  settings.updateProvider("openai", { enabled: false });
  assert.throws(() => resolver("openai"), { code: "provider_disabled" });
  assert.equal(requests.length, 3);
});

// Tests for the application's startup behavior, particularly ignoring obsolete provider environment variables and initializing settings without importing secrets.
test("startup ignores obsolete provider ENV and initializes settings without importing secrets", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-provider-startup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const databaseFile = join(directory, "settings.sqlite");
  const logFile = join(directory, "backend.log");
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
        LLM_PROVIDER: "unsupported",
        OLLAMA_MODEL: "",
        OPENAI_API_KEY: "test-only-secret",
        DATABASE_FILE: databaseFile,
        LOG_FILE: logFile,
        SCANS_DIR: join(directory, "scans"),
        PYTHON_EXECUTABLE: join(directory, "missing-python"),
        SECRETS_KEY_DIR: join(directory, "keys"),
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.ok(existsSync(databaseFile));
  assert.ok(result.stderr.includes("worker readiness and HTTP startup"));
  const { db, sqlite } = createDatabase(databaseFile);
  try {
    const settings = new ProviderSettingsService(
      db,
      new SecretStorage(join(directory, "keys")),
    ).getSettings();
    assert.equal(settings.defaultProvider, null);
    assert.ok(
      settings.providers.every(
        (provider) => !provider.enabled && !provider.hasApiKey,
      ),
    );
    assert.equal(existsSync(join(directory, "keys")), false);
  } finally {
    sqlite.close();
  }
  assert.equal(
    (readFileSync(logFile, "utf8") + result.stdout + result.stderr).includes(
      "test-only-secret",
    ),
    false,
  );
});
