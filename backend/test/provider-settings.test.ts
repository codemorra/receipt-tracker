import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/database.js";
import { aiProviderSettings } from "../src/db/schema.js";
import { ProviderSettingsService } from "../src/settings/provider-settings-service.js";
import { ProviderSettingsError } from "../src/settings/provider-settings.js";
import {
  SecretStorage,
  SecretStorageError,
  defaultSecretKeyDirectory,
} from "../src/settings/secret-storage.js";

// Fixture and tests for provider settings service.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "receipt-settings-"));
  const databasePath = join(directory, "settings.sqlite");
  const keyDirectory = join(directory, "separate-config", "keys");
  const keyPath = join(keyDirectory, "master.key");
  const { db, sqlite } = createDatabase(databasePath);
  const secrets = new SecretStorage(keyDirectory);
  const service = new ProviderSettingsService(db, secrets);
  return {
    directory,
    databasePath,
    keyDirectory,
    keyPath,
    db,
    sqlite,
    secrets,
    service,
    close() {
      sqlite.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

// Initialize settings without provider ENV, keys, models, or an implicit default and survive reopen.
test("settings initialize without provider ENV, keys, models, or an implicit default and survive reopen", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;
  process.env.OPENAI_API_KEY = "unused-env-key";
  process.env.LLM_PROVIDER = "openai";
  const f = fixture();
  try {
    assert.deepEqual(f.service.getSettings(), {
      defaultProvider: null,
      providers: [
        {
          provider: "ollama",
          enabled: false,
          model: "",
          baseUrl: "http://127.0.0.1:11434",
          hasApiKey: false,
          selectable: false,
          configurationIssues: ["missing_model"],
        },
        {
          provider: "openai",
          enabled: false,
          model: "",
          hasApiKey: false,
          selectable: false,
          configurationIssues: ["missing_model", "missing_api_key"],
        },
      ],
    });
    assert.equal(existsSync(f.keyDirectory), false);
    f.service.updateProvider("ollama", {
      model: " local-model ",
      baseUrl: "http://localhost:11434/nested/",
      enabled: true,
    });
    f.service.setDefaultProvider("ollama");
    const reopened = createDatabase(f.databasePath);
    try {
      const service = new ProviderSettingsService(reopened.db, f.secrets);
      assert.deepEqual(service.getSettings(), f.service.getSettings());
      assert.equal(
        service.getSettings().providers[0].baseUrl,
        "http://localhost:11434/nested",
      );
    } finally {
      reopened.sqlite.close();
    }
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = originalProvider;
    f.close();
  }
});

// Validate that provider settings reject invalid configurations without exposing sensitive values.
test("provider validation rejects invalid settings without echoing submitted values", () => {
  const f = fixture();
  try {
    const before = f.service.getSettings();
    const invalid: [unknown, unknown][] = [
      ["unknown", { model: "model" }],
      ["mistral", { model: "model" }],
      ["ollama", { enabled: true }],
      ["ollama", { apiKey: { action: "set", value: "submitted-secret" } }],
      ["ollama", { baseUrl: "https://user:submitted-secret@example.com" }],
      ["ollama", { baseUrl: "http://localhost:11434/?key=submitted-secret" }],
      ["ollama", { baseUrl: "http://localhost:11434/#fragment" }],
      ["ollama", { baseUrl: "file:///tmp/model" }],
      ["openai", { baseUrl: "https://foreign.example/v1" }],
      ["openai", { model: "model", enabled: true }],
      ["openai", { apiKey: { action: "set", value: " " } }],
      ["openai", { unknown: "submitted-secret" }],
      ["openai", {}],
    ];
    for (const [provider, input] of invalid) {
      assert.throws(
        () => f.service.updateProvider(provider, input),
        (error) => {
          assert.ok(error instanceof ProviderSettingsError);
          assert.ok(!String(error).includes("submitted-secret"));
          assert.ok(!JSON.stringify(error).includes("submitted-secret"));
          return true;
        },
      );
      assert.deepEqual(f.service.getSettings(), before);
    }
    assert.throws(() => f.service.setDefaultProvider("openai"), {
      code: "provider_not_selectable",
    });
  } finally {
    f.close();
  }
});

// Test that API keys are stored encrypted and that the service only exposes their presence, not the actual values.
test("API keys persist encrypted and set/replace/delete responses expose only presence", () => {
  const f = fixture();
  try {
    const firstKey = "test-first-private-api-key";
    const replacementKey = "test-replacement-private-api-key";
    const first = f.service.updateProvider("openai", {
      model: "cloud-model",
      enabled: true,
      apiKey: { action: "set", value: firstKey },
    });
    assert.equal(first.hasApiKey, true);
    assert.equal(first.selectable, true);
    const readEncrypted = () =>
      f.db
        .select()
        .from(aiProviderSettings)
        .where(eq(aiProviderSettings.provider, "openai"))
        .get()!.apiKeyEncrypted!;
    const initialEncrypted = readEncrypted();
    assert.equal(f.secrets.decrypt("openai", initialEncrypted), firstKey);
    assert.ok(!initialEncrypted.includes(firstKey));
    f.service.setDefaultProvider("openai");
    f.service.updateProvider("openai", { model: "updated-model" });
    assert.equal(readEncrypted(), initialEncrypted);
    const replaced = f.service.updateProvider("openai", {
      apiKey: { action: "set", value: replacementKey },
    });
    assert.notEqual(readEncrypted(), initialEncrypted);
    assert.equal(f.secrets.decrypt("openai", readEncrypted()), replacementKey);
    const serialized = JSON.stringify([
      first,
      replaced,
      f.service.getSettings(),
    ]);
    assert.ok(
      !serialized.includes(firstKey) && !serialized.includes(replacementKey),
    );
    assert.ok(
      !serialized.includes("ciphertext") &&
        !serialized.includes("apiKeyEncrypted"),
    );
    const persistedBytes = readFileSync(f.databasePath);
    assert.ok(!persistedBytes.includes(Buffer.from(firstKey)));
    assert.ok(!persistedBytes.includes(Buffer.from(replacementKey)));
    const reopened = createDatabase(f.databasePath);
    try {
      assert.equal(
        new ProviderSettingsService(
          reopened.db,
          new SecretStorage(f.keyDirectory),
        ).getSettings().providers[1].selectable,
        true,
      );
    } finally {
      reopened.sqlite.close();
    }
    const removed = f.service.updateProvider("openai", {
      apiKey: { action: "remove" },
    });
    assert.equal(removed.hasApiKey, false);
    assert.equal(removed.enabled, false);
    assert.equal(f.service.getSettings().defaultProvider, null);
    assert.equal(readEncrypted(), null);
  } finally {
    f.close();
  }
});

// Test that multiple providers remain independent and that removing the default provider does not automatically fall back to another provider.
test("multiple providers remain independent and default removal never falls back", () => {
  const f = fixture();
  try {
    f.service.updateProvider("ollama", { enabled: true, model: "local-model" });
    f.service.updateProvider("openai", {
      enabled: true,
      model: "cloud-model",
      apiKey: { action: "set", value: "fake-openai-key" },
    });
    assert.ok(
      f.service
        .getSettings()
        .providers.every((provider) => provider.selectable),
    );
    assert.equal(f.service.getSettings().defaultProvider, null);
    f.service.setDefaultProvider("openai");
    f.service.updateProvider("ollama", { enabled: false });
    assert.equal(f.service.getSettings().defaultProvider, "openai");
    f.service.updateProvider("ollama", { enabled: true });
    f.service.updateProvider("openai", { enabled: false });
    assert.equal(f.service.getSettings().defaultProvider, null);
    assert.equal(f.service.getSettings().providers[0].selectable, true);
    f.service.setDefaultProvider("ollama");
    f.service.setDefaultProvider(null);
    assert.equal(f.service.getSettings().defaultProvider, null);
  } finally {
    f.close();
  }
});

// Test that invalid combined updates roll back key, configuration, and default together.
test("invalid combined updates roll back key, configuration, and default together", () => {
  const f = fixture();
  try {
    f.service.updateProvider("openai", {
      enabled: true,
      model: "model",
      apiKey: { action: "set", value: "original-key" },
    });
    f.service.setDefaultProvider("openai");
    const before = f.service.getSettings();
    const ciphertext = f.db
      .select()
      .from(aiProviderSettings)
      .where(eq(aiProviderSettings.provider, "openai"))
      .get()!.apiKeyEncrypted;
    assert.throws(
      () =>
        f.service.updateProvider("openai", {
          model: "",
          apiKey: { action: "set", value: "replacement-key" },
        }),
      { code: "provider_configuration_incomplete" },
    );
    assert.throws(
      () =>
        f.service.updateProvider("openai", {
          enabled: true,
          apiKey: { action: "remove" },
        }),
      { code: "provider_configuration_incomplete" },
    );
    assert.deepEqual(f.service.getSettings(), before);
    assert.equal(
      f.db
        .select()
        .from(aiProviderSettings)
        .where(eq(aiProviderSettings.provider, "openai"))
        .get()!.apiKeyEncrypted,
      ciphertext,
    );
  } finally {
    f.close();
  }
});

// Test that missing or wrong master key marks secrets unavailable without generating a replacement.
test("missing or wrong master key marks secrets unavailable without generating a replacement", () => {
  const f = fixture();
  try {
    f.service.updateProvider("openai", {
      model: "model",
      enabled: true,
      apiKey: { action: "set", value: "private-key" },
    });
    const originalKey = readFileSync(f.keyPath);
    rmSync(f.keyPath);
    const unavailable = f.service.getSettings().providers[1];
    assert.equal(unavailable.hasApiKey, true);
    assert.equal(unavailable.selectable, false);
    assert.deepEqual(unavailable.configurationIssues, ["secret_unavailable"]);
    assert.throws(
      () =>
        f.service.updateProvider("openai", {
          apiKey: { action: "set", value: "new-key" },
        }),
      { code: "secret_key_unavailable" },
    );
    assert.equal(existsSync(f.keyPath), false);
    writeFileSync(f.keyPath, randomBytes(32), { mode: 0o600 });
    assert.throws(() => f.service.updateProvider("openai", { enabled: true }), {
      code: "secret_decryption_failed",
    });
    assert.throws(
      () =>
        f.service.updateProvider("openai", {
          apiKey: { action: "set", value: "new-key" },
        }),
      { code: "secret_decryption_failed" },
    );
    writeFileSync(f.keyPath, originalKey);
    assert.equal(f.service.getSettings().providers[1].selectable, true);
    rmSync(f.keyPath);
    f.service.updateProvider("openai", { apiKey: { action: "remove" } });
    f.service.updateProvider("openai", {
      enabled: true,
      apiKey: { action: "set", value: "reentered-key" },
    });
    assert.equal(f.service.getSettings().providers[1].selectable, true);
  } finally {
    f.close();
  }
});

// Test that authenticated encryption uses fresh nonces and rejects tampering, other providers, and versions.
test("authenticated encryption uses fresh nonces and rejects tampering, other providers, and versions", () => {
  const f = fixture();
  try {
    const first = f.secrets.encrypt("openai", "private-key", false);
    const second = f.secrets.encrypt("openai", "private-key", true);
    assert.notEqual(JSON.parse(first).nonce, JSON.parse(second).nonce);
    assert.equal(f.secrets.decrypt("openai", first), "private-key");
    for (const encrypted of [
      JSON.stringify({
        ...JSON.parse(first),
        ciphertext: randomBytes(11).toString("base64"),
      }),
      JSON.stringify({ ...JSON.parse(first), version: 2 }),
      "invalid-json-private-key",
    ]) {
      assert.throws(
        () => f.secrets.decrypt("openai", encrypted),
        (error) => {
          assert.ok(error instanceof SecretStorageError);
          assert.equal(error.code, "secret_decryption_failed");
          assert.ok(!String(error).includes("private-key"));
          return true;
        },
      );
    }
    assert.throws(() => f.secrets.decrypt("ollama", first), {
      code: "secret_decryption_failed",
    });
    writeFileSync(f.keyPath, Buffer.alloc(31));
    assert.throws(() => f.secrets.decrypt("openai", first), {
      code: "secret_key_unavailable",
    });
  } finally {
    f.close();
  }
});

// Test that the master key defaults to a location outside the repository and that its creation enforces private Unix permissions.
test("master key defaults live outside the repository and creation enforces private Unix permissions", () => {
  assert.equal(
    defaultSecretKeyDirectory({ XDG_CONFIG_HOME: "/tmp/private-config" }),
    "/tmp/private-config/receipt-tracker/keys",
  );
  assert.equal(
    defaultSecretKeyDirectory({ SECRETS_KEY_DIR: "/tmp/custom-keys" }),
    "/tmp/custom-keys",
  );
  assert.throws(
    () => defaultSecretKeyDirectory({ SECRETS_KEY_DIR: "relative/keys" }),
    { code: "secret_key_unavailable" },
  );
  const f = fixture();
  try {
    f.secrets.encrypt("openai", "private-key", false);
    assert.equal(readFileSync(f.keyPath).length, 32);
    if (process.platform !== "win32") {
      assert.equal(statSync(f.keyDirectory).mode & 0o777, 0o700);
      assert.equal(statSync(f.keyPath).mode & 0o777, 0o600);
      chmodSync(f.keyPath, 0o644);
      assert.throws(() => f.secrets.encrypt("openai", "private-key", true), {
        code: "secret_key_unavailable",
      });
      chmodSync(f.keyPath, 0o600);
      chmodSync(f.keyDirectory, 0o755);
      assert.throws(() => f.secrets.encrypt("openai", "private-key", true), {
        code: "secret_key_unavailable",
      });
      chmodSync(f.keyDirectory, 0o700);
      rmSync(f.keyPath);
      const target = join(f.directory, "external-key");
      writeFileSync(target, randomBytes(32), { mode: 0o600 });
      symlinkSync(target, f.keyPath);
      assert.throws(() => f.secrets.encrypt("openai", "private-key", false), {
        code: "secret_key_unavailable",
      });
    }
  } finally {
    f.close();
  }
});

// HTTP integration: the service must never be serialized wholesale, including on errors.
test("settings API persists edits and defaults without exposing keys or encrypted envelopes", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const { createApp } = await import("../src/app.js");
  const { ScanSessionService } =
    await import("../src/scans/scan-session-service.js");
  const events: string[] = [];
  const scans = new ScanSessionService(join(f.directory, "scans"), {
    async requestPreview() {
      throw new Error("Unexpected worker request");
    },
    async requestProcess() {
      throw new Error("Unexpected worker request");
    },
  });
  const app = createApp(
    scans,
    f.db,
    () => {
      throw new Error("Unexpected provider request");
    },
    f.directory,
    (level, operation, fields) =>
      events.push(JSON.stringify({ level, operation, fields })),
    f.service,
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/settings/ai`;
  const headers = {
    "content-type": "application/json",
    "x-receipt-tracker-settings": "1",
    origin: "http://localhost:5173",
  };
  const responses: string[] = [];
  const patch = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    responses.push(text);
    return { status: response.status, body: JSON.parse(text) };
  };
  const initial = await fetch(base, { headers });
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("cache-control"), "no-store");
  assert.equal((await initial.json()).defaultProvider, null);
  const key = "api-integration-private-key";
  const configured = await patch("/providers/openai", {
    enabled: true,
    model: "model",
    apiKey: { action: "set", value: key },
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.hasApiKey, true);
  assert.equal(configured.body.selectable, true);
  assert.deepEqual(await patch("/default-provider", { provider: "openai" }), {
    status: 200,
    body: { defaultProvider: "openai" },
  });
  assert.equal(
    (
      await patch("/providers/openai", {
        apiKey: { action: "set", value: "api-replacement-private-key" },
      })
    ).status,
    200,
  );
  assert.deepEqual(
    await patch("/providers/openai", { baseUrl: "https://foreign.example" }),
    { status: 400, body: { error: "invalid_provider_settings" } },
  );
  assert.deepEqual(await patch("/default-provider", { provider: "ollama" }), {
    status: 409,
    body: { error: "provider_not_selectable" },
  });
  rmSync(f.keyPath);
  const unreadable = await fetch(base, { headers });
  const unreadableText = await unreadable.text();
  responses.push(unreadableText);
  assert.equal(JSON.parse(unreadableText).providers[1].hasApiKey, true);
  assert.equal(JSON.parse(unreadableText).providers[1].selectable, false);
  assert.deepEqual(await patch("/providers/openai", { enabled: true }), {
    status: 503,
    body: { error: "secret_key_unavailable" },
  });
  assert.equal(
    (await patch("/providers/openai", { apiKey: { action: "remove" } })).body
      .hasApiKey,
    false,
  );
  assert.equal(f.service.getSettings().defaultProvider, null);
  for (const sensitive of [
    key,
    "api-replacement-private-key",
    "ciphertext",
    "apiKeyEncrypted",
  ]) {
    assert.equal(
      (responses.join("\n") + events.join("\n")).includes(sensitive),
      false,
    );
  }
});

// Tests for the settings API's handling of foreign browser requests, host rebinding attempts, and unsafe payloads.
test("settings API rejects foreign browser requests, rebinding hosts and unsafe payloads", async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const { createApp } = await import("../src/app.js");
  const { ScanSessionService } =
    await import("../src/scans/scan-session-service.js");
  const scans = new ScanSessionService(join(f.directory, "scans"), {
    async requestPreview() {
      throw new Error("Unexpected worker request");
    },
    async requestProcess() {
      throw new Error("Unexpected worker request");
    },
  });
  const server = createApp(
    scans,
    f.db,
    () => {
      throw new Error("Unexpected provider request");
    },
    f.directory,
    undefined,
    f.service,
  ).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/settings/ai`;
  const required = { "x-receipt-tracker-settings": "1" };
  const original = f.service.getSettings();
  for (const headers of [
    {},
    { ...required, origin: "https://foreign.example" },
    { ...required, origin: "null" },
  ]) {
    const response = await fetch(`${base}/providers/ollama`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ enabled: true, model: "model" }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "settings_request_forbidden",
    });
  }
  // Fetch manages Host itself; send an actual forged Host through the HTTP client.
  const rebinding = await new Promise<{ status: number; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        `${base}/providers/ollama`,
        {
          method: "PATCH",
          headers: {
            ...required,
            "content-type": "application/json",
            host: "rebind.example",
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk.toString();
          });
          response.on("end", () =>
            resolve({ status: response.statusCode!, body }),
          );
        },
      );
      request.on("error", reject);
      request.end(JSON.stringify({ enabled: true, model: "model" }));
    },
  );
  assert.equal(rebinding.status, 403);
  assert.deepEqual(JSON.parse(rebinding.body), {
    error: "settings_request_forbidden",
  });
  const preflight = await fetch(`${base}/providers/ollama`, {
    method: "OPTIONS",
    headers: {
      origin: "https://foreign.example",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "x-receipt-tracker-settings",
    },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  const nonJson = await fetch(`${base}/providers/ollama`, {
    method: "PATCH",
    headers: { ...required, "content-type": "text/plain" },
    body: "private-submitted-key",
  });
  assert.equal(nonJson.status, 415);
  const invalidJson = await fetch(`${base}/providers/ollama`, {
    method: "PATCH",
    headers: { ...required, "content-type": "application/json" },
    body: '{"apiKey":"private-submitted-key"',
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { error: "invalid_request" });
  const oversized = await fetch(`${base}/providers/ollama`, {
    method: "PATCH",
    headers: { ...required, "content-type": "application/json" },
    body: JSON.stringify({ apiKey: "private-submitted-key".repeat(4000) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), {
    error: "settings_payload_too_large",
  });
  assert.deepEqual(f.service.getSettings(), original);
});
