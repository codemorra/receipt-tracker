import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderSettings,
  updateProviderSettings,
  updateDefaultProvider,
  ProviderSettingsApiError,
  providerResetUpdate,
} from "../src/api/provider-settings-api.ts";

// Mock data for AI providers used in the tests.
const providers = ["ollama", "mistral", "openai"].map((provider) => ({
  provider,
  enabled: false,
  model: "",
  hasApiKey: false,
  selectable: false,
  configurationIssues: ["missing_model"],
  ...(provider === "ollama" ? { baseUrl: "http://127.0.0.1:11434" } : {}),
}));

// Test suite for the provider settings API.
test("reads only public settings and sends the required settings header without caching", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/settings/ai");
    assert.equal(init.method, "GET");
    assert.equal(init.headers["x-receipt-tracker-settings"], "1");
    assert.equal(init.cache, "no-store");
    return Response.json({
      providers: providers.map((provider) => ({
        ...provider,
        apiKey: "unexpected-private-key",
        apiKeyEncrypted: "unexpected-ciphertext",
      })),
      defaultProvider: null,
    });
  });
  const settings = await getProviderSettings();
  assert.deepEqual(settings, { providers, defaultProvider: null });
  assert.equal(
    JSON.stringify(settings).includes("unexpected-private-key"),
    false,
  );
  assert.equal(
    JSON.stringify(settings).includes("unexpected-ciphertext"),
    false,
  );
});

// Test suite for set/replace/remove key actions and default provider changes.
test("set/replace/remove key actions remain in JSON bodies and default changes are checked", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init });
    const body = JSON.parse(init.body);
    return Response.json(
      url.endsWith("default-provider")
        ? { defaultProvider: body.provider }
        : providers[1],
    );
  });
  for (const apiKey of [
    undefined,
    { action: "set", value: "test-private-key" },
    { action: "remove" },
  ]) {
    await updateProviderSettings("mistral", {
      enabled: false,
      model: "model",
      ...(apiKey ? { apiKey } : {}),
    });
  }
  await updateDefaultProvider(null);
  assert.equal(requests[0].init.body.includes("apiKey"), false);
  assert.deepEqual(JSON.parse(requests[1].init.body).apiKey, {
    action: "set",
    value: "test-private-key",
  });
  assert.deepEqual(JSON.parse(requests[2].init.body).apiKey, {
    action: "remove",
  });
  for (const { url, init } of requests) {
    assert.equal(init.method, "PATCH");
    assert.equal(init.headers["content-type"], "application/json");
    assert.equal(init.headers["x-receipt-tracker-settings"], "1");
    assert.equal(url.includes("test-private-key"), false);
  }
});

// Test suite for handling API errors and ensuring proper error codes are preserved.
test("API errors preserve known codes and discard unknown details, HTML, and transport errors", async (t) => {
  let response = () =>
    Response.json(
      { error: "secret_key_unavailable", message: "private-key" },
      { status: 503 },
    );
  t.mock.method(globalThis, "fetch", async () => response());
  for (const [next, expected] of [
    [
      () =>
        Response.json(
          { error: "secret_key_unavailable", message: "private-key" },
          { status: 503 },
        ),
      "secret_key_unavailable",
    ],
    [
      () => Response.json({ error: "private-key" }, { status: 500 }),
      "unexpected_response",
    ],
    [() => new Response("private-key", { status: 502 }), "unexpected_response"],
    [
      () => {
        throw new Error("private-key");
      },
      "network_error",
    ],
  ]) {
    response = next;
    await assert.rejects(getProviderSettings(), (error) => {
      assert.ok(error instanceof ProviderSettingsApiError);
      assert.equal(error.code, expected);
      assert.equal(String(error).includes("private-key"), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getProviderSettings(controller.signal), {
    name: "AbortError",
  });
});

// Test suite for handling malformed or mismatched API responses.
test("malformed or mismatched responses cannot enter settings state", async (t) => {
  let payload = {
    providers: [providers[0], providers[0], providers[2]],
    defaultProvider: null,
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  await assert.rejects(getProviderSettings(), { code: "unexpected_response" });
  payload = { providers: [...providers], defaultProvider: "unknown" };
  await assert.rejects(getProviderSettings(), { code: "unexpected_response" });
  payload = providers[0];
  await assert.rejects(
    updateProviderSettings("mistral", { enabled: false, model: "model" }),
    { code: "unexpected_response" },
  );
  payload = { defaultProvider: "mistral" };
  await assert.rejects(updateDefaultProvider("ollama"), {
    code: "unexpected_response",
  });
});

// Test suite for verifying that deleting a saved provider configuration correctly resets its settings.
test("deleting a saved configuration resets the model and credentials for its provider", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const provider = url.split("/").at(-1);
    const update = JSON.parse(init.body);
    requests.push({ provider, update });
    return Response.json(
      providers.find((entry) => entry.provider === provider),
    );
  });
  for (const provider of ["ollama", "mistral", "openai"]) {
    await updateProviderSettings(provider, providerResetUpdate(provider));
  }
  assert.deepEqual(requests, [
    {
      provider: "ollama",
      update: { enabled: false, model: "", baseUrl: "http://127.0.0.1:11434" },
    },
    {
      provider: "mistral",
      update: { enabled: false, model: "", apiKey: { action: "remove" } },
    },
    {
      provider: "openai",
      update: { enabled: false, model: "", apiKey: { action: "remove" } },
    },
  ]);
});
