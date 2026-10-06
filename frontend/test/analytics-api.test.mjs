import assert from "node:assert/strict";
import test from "node:test";
import {
  getSpending,
  getAnalyticsMerchant,
  spendingQuery,
} from "../src/api/analytics-api.ts";

const data = {
  currency: "EUR",
  range: { from: "2026-01-01", to: "2026-01-02" },
  granularity: "daily",
  summary: { totalCents: 101, receiptCount: 1, averageReceiptCents: 101 },
  timeline: [
    { period: "2026-01-01", totalCents: 101, receiptCount: 1 },
    { period: "2026-01-02", totalCents: 0, receiptCount: 0 },
  ],
  merchants: [
    { merchantId: 7, name: "Market", receiptCount: 1, totalCents: 101 },
  ],
};

// Tests for the spending API's basic functionality, including query construction and request cancellation.
test("spending API preserves aggregate data, query filters and request cancellation", async (t) => {
  const controller = new AbortController();
  const query = spendingQuery({
    from: "2026-01-01",
    to: "2026-01-02",
    merchantId: 7,
  });
  t.mock.method(globalThis, "fetch", async (path, init) => {
    assert.equal(path, `/api/analytics/spending?${query}`);
    assert.equal(init.signal, controller.signal);
    assert.equal(init.cache, "no-store");
    return Response.json(data);
  });
  assert.deepEqual(await getSpending(query, controller.signal), data);
  assert.equal(spendingQuery({}), "");
  const empty = {
    currency: null,
    range: { from: null, to: null },
    granularity: "daily",
    summary: { totalCents: 0, receiptCount: 0, averageReceiptCents: null },
    timeline: [],
    merchants: [],
  };
  t.mock.method(globalThis, "fetch", async () => Response.json(empty));
  assert.deepEqual(await getSpending(""), empty);
});

// Tests for the spending API's error handling and response validation.
test("spending API rejects malformed aggregate contracts and exposes safe error codes", async (t) => {
  for (const invalid of [
    null,
    { ...data, currency: "EU" },
    { ...data, granularity: "yearly" },
    { ...data, summary: { ...data.summary, averageReceiptCents: null } },
    { ...data, range: { from: "2026-02-30", to: "2026-03-01" } },
    { ...data, timeline: data.timeline.toReversed() },
    { ...data, timeline: [] },
    { ...data, merchants: [...data.merchants, ...data.merchants] },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(invalid));
    await assert.rejects(getSpending(""), { code: "unexpected_response" });
  }
  for (const [status, code] of [
    [400, "invalid_analytics_query"],
    [404, "merchant_not_found"],
    [422, "analytics_mixed_currencies"],
    [500, "analytics_spending_failed"],
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: "private details" }, { status }),
    );
    await assert.rejects(getSpending(""), { code, message: code });
  }
  t.mock.method(globalThis, "fetch", async () => new Response("invalid json"));
  await assert.rejects(getSpending(""), { code: "unexpected_response" });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("private details");
  });
  await assert.rejects(getSpending(""), { code: "network_error" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getSpending("", controller.signal), {
    name: "AbortError",
  });
});

// Tests for the merchant ID hydration API's behavior and error handling.
test("merchant ID hydration accepts only the selected merchant and handles removed merchants", async (t) => {
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.equal(path, "/api/merchants?id=77");
    return Response.json([{ id: 77, name: "Saved merchant" }]);
  });
  assert.deepEqual(await getAnalyticsMerchant(77), {
    id: 77,
    name: "Saved merchant",
  });
  for (const value of [
    [],
    [{ id: 1, name: "Wrong merchant" }],
    [{ id: 77, name: null }],
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(value));
    await assert.rejects(getAnalyticsMerchant(77), {
      code: "unexpected_response",
    });
  }
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "merchant_not_found" }, { status: 404 }),
  );
  await assert.rejects(getAnalyticsMerchant(77), {
    code: "merchant_not_found",
  });
});
