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
  const originalKey = process.env.MISTRAL_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;
  process.env.MISTRAL_API_KEY = "unused-env-key";
  process.env.LLM_PROVIDER = "mistral";
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
          provider: "mistral",
          enabled: false,
          model: "",
          hasApiKey: false,
          selectable: false,
          configurationIssues: ["missing_model", "missing_api_key"],
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
    if (originalKey === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = originalKey;
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
      ["ollama", { enabled: true }],
      ["ollama", { apiKey: { action: "set", value: "submitted-secret" } }],
      ["ollama", { baseUrl: "https://user:submitted-secret@example.com" }],
      ["ollama", { baseUrl: "http://localhost:11434/?key=submitted-secret" }],
      ["ollama", { baseUrl: "http://localhost:11434/#fragment" }],
      ["ollama", { baseUrl: "file:///tmp/model" }],
      ["mistral", { baseUrl: "https://foreign.example/v1" }],
      ["openai", { baseUrl: "https://foreign.example/v1" }],
      ["mistral", { model: "model", enabled: true }],
      ["openai", { apiKey: { action: "set", value: " " } }],
      ["mistral", { unknown: "submitted-secret" }],
      ["mistral", {}],
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
    const first = f.service.updateProvider("mistral", {
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
        .where(eq(aiProviderSettings.provider, "mistral"))
        .get()!.apiKeyEncrypted!;
    const initialEncrypted = readEncrypted();
    assert.equal(f.secrets.decrypt("mistral", initialEncrypted), firstKey);
    assert.ok(!initialEncrypted.includes(firstKey));
    f.service.setDefaultProvider("mistral");
    f.service.updateProvider("mistral", { model: "updated-model" });
    assert.equal(readEncrypted(), initialEncrypted);
    const replaced = f.service.updateProvider("mistral", {
      apiKey: { action: "set", value: replacementKey },
    });
    assert.notEqual(readEncrypted(), initialEncrypted);
    assert.equal(f.secrets.decrypt("mistral", readEncrypted()), replacementKey);
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
    const removed = f.service.updateProvider("mistral", {
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
    for (const provider of ["mistral", "openai"] as const) {
      f.service.updateProvider(provider, {
        enabled: true,
        model: "cloud-model",
        apiKey: { action: "set", value: `fake-${provider}-key` },
      });
    }
    assert.ok(
      f.service
        .getSettings()
        .providers.every((provider) => provider.selectable),
    );
    assert.equal(f.service.getSettings().defaultProvider, null);
    f.service.setDefaultProvider("openai");
    f.service.updateProvider("mistral", { enabled: false });
    assert.equal(f.service.getSettings().defaultProvider, "openai");
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
    f.service.updateProvider("mistral", {
      enabled: true,
      model: "model",
      apiKey: { action: "set", value: "original-key" },
    });
    f.service.setDefaultProvider("mistral");
    const before = f.service.getSettings();
    const ciphertext = f.db
      .select()
      .from(aiProviderSettings)
      .where(eq(aiProviderSettings.provider, "mistral"))
      .get()!.apiKeyEncrypted;
    assert.throws(
      () =>
        f.service.updateProvider("mistral", {
          model: "",
          apiKey: { action: "set", value: "replacement-key" },
        }),
      { code: "provider_configuration_incomplete" },
    );
    assert.throws(
      () =>
        f.service.updateProvider("mistral", {
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
        .where(eq(aiProviderSettings.provider, "mistral"))
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
    f.service.updateProvider("mistral", {
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
    assert.throws(
      () => f.service.updateProvider("mistral", { enabled: true }),
      { code: "secret_decryption_failed" },
    );
    assert.throws(
      () =>
        f.service.updateProvider("mistral", {
          apiKey: { action: "set", value: "new-key" },
        }),
      { code: "secret_decryption_failed" },
    );
    writeFileSync(f.keyPath, originalKey);
    assert.equal(f.service.getSettings().providers[1].selectable, true);
    rmSync(f.keyPath);
    f.service.updateProvider("mistral", { apiKey: { action: "remove" } });
    f.service.updateProvider("mistral", {
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
    const first = f.secrets.encrypt("mistral", "private-key", false);
    const second = f.secrets.encrypt("mistral", "private-key", true);
    assert.notEqual(JSON.parse(first).nonce, JSON.parse(second).nonce);
    assert.equal(f.secrets.decrypt("mistral", first), "private-key");
    for (const encrypted of [
      JSON.stringify({
        ...JSON.parse(first),
        ciphertext: randomBytes(11).toString("base64"),
      }),
      JSON.stringify({ ...JSON.parse(first), version: 2 }),
      "invalid-json-private-key",
    ]) {
      assert.throws(
        () => f.secrets.decrypt("mistral", encrypted),
        (error) => {
          assert.ok(error instanceof SecretStorageError);
          assert.equal(error.code, "secret_decryption_failed");
          assert.ok(!String(error).includes("private-key"));
          return true;
        },
      );
    }
    assert.throws(() => f.secrets.decrypt("openai", first), {
      code: "secret_decryption_failed",
    });
    writeFileSync(f.keyPath, Buffer.alloc(31));
    assert.throws(() => f.secrets.decrypt("mistral", first), {
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
    f.secrets.encrypt("mistral", "private-key", false);
    assert.equal(readFileSync(f.keyPath).length, 32);
    if (process.platform !== "win32") {
      assert.equal(statSync(f.keyDirectory).mode & 0o777, 0o700);
      assert.equal(statSync(f.keyPath).mode & 0o777, 0o600);
      chmodSync(f.keyPath, 0o644);
      assert.throws(() => f.secrets.encrypt("mistral", "private-key", true), {
        code: "secret_key_unavailable",
      });
      chmodSync(f.keyPath, 0o600);
      chmodSync(f.keyDirectory, 0o755);
      assert.throws(() => f.secrets.encrypt("mistral", "private-key", true), {
        code: "secret_key_unavailable",
      });
      chmodSync(f.keyDirectory, 0o700);
      rmSync(f.keyPath);
      const target = join(f.directory, "external-key");
      writeFileSync(target, randomBytes(32), { mode: 0o600 });
      symlinkSync(target, f.keyPath);
      assert.throws(() => f.secrets.encrypt("mistral", "private-key", false), {
        code: "secret_key_unavailable",
      });
    }
  } finally {
    f.close();
  }
});
