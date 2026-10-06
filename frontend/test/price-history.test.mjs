import assert from "node:assert/strict";
import test from "node:test";
import { getPriceHistory } from "../src/api/analytics-api.ts";
import { priceChartPoints, DAY_MS } from "../src/analytics/price-history.ts";

const purchase = {
  receiptItemId: 1,
  receiptId: 10,
  purchaseDate: "2026-01-01",
  purchaseTime: null,
  merchantId: 7,
  merchantName: "Market",
  currency: "EUR",
  unitPriceCents: 101,
  quantity: 2,
};
const data = {
  product: {
    id: 17,
    name: "Whole Milk",
    brandName: "Brand",
    productGroupName: "Milk",
    packageAmount: 1,
    packageUnit: "l",
  },
  currency: "EUR",
  statistics: {
    latestCents: 200,
    minimumCents: 0,
    maximumCents: 200,
    averageCents: 100,
  },
  history: [
    purchase,
    {
      ...purchase,
      receiptItemId: 2,
      receiptId: 11,
      purchaseDate: "2026-01-02",
      unitPriceCents: null,
    },
    {
      ...purchase,
      receiptItemId: 3,
      receiptId: 12,
      purchaseDate: "2026-01-11",
      unitPriceCents: 0,
    },
    {
      ...purchase,
      receiptItemId: 4,
      receiptId: 13,
      purchaseDate: "2026-01-11",
      purchaseTime: "09:00",
      unitPriceCents: 200,
    },
  ],
};

// Tests for the price history API and related functionality.
test("price history API restores the selected product and preserves filtered observations", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (path, init) => {
    const url = new URL(path, "http://localhost");
    assert.equal(url.pathname, "/api/analytics/price-history");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      from: "2026-01-01",
      to: "2026-01-11",
      merchantId: "7",
      productId: "17",
    });
    assert.equal(init.signal, controller.signal);
    assert.equal(init.cache, "no-store");
    return Response.json(data);
  });
  assert.deepEqual(
    await getPriceHistory(
      17,
      "from=2026-01-01&to=2026-01-11&merchantId=7",
      controller.signal,
    ),
    data,
  );
  const empty = {
    ...data,
    currency: null,
    statistics: {
      latestCents: null,
      minimumCents: null,
      maximumCents: null,
      averageCents: null,
    },
    history: [],
  };
  for (const result of [
    empty,
    {
      ...empty,
      product: {
        ...data.product,
        brandName: null,
        packageAmount: null,
        packageUnit: null,
      },
      history: [{ ...purchase, unitPriceCents: null }],
    },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    assert.deepEqual(await getPriceHistory(17, ""), result);
  }
});

// Tests for handling invalid price history responses and edge cases.
test("price history rejects wrong products, invalid metadata/prices and unordered or duplicate observations", async (t) => {
  for (const invalid of [
    null,
    { ...data, product: { ...data.product, id: 18 } },
    { ...data, product: { ...data.product, packageAmount: -1 } },
    { ...data, product: { ...data.product, productGroupName: null } },
    { ...data, statistics: { ...data.statistics, latestCents: null } },
    { ...data, currency: null },
    { ...data, history: data.history.toReversed() },
    { ...data, history: [...data.history, data.history[3]] },
    ...[
      { unitPriceCents: 1.5 },
      { purchaseDate: "2026-02-30" },
      { purchaseTime: "25:00" },
      { quantity: 0 },
      { currency: "USD" },
    ].map((change) => ({
      ...data,
      history: [{ ...purchase, ...change }, ...data.history.slice(1)],
    })),
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json(invalid));
    await assert.rejects(getPriceHistory(17, ""), {
      code: "unexpected_response",
    });
  }
});

// Tests for distinguishing removed products and merchants, and for sanitizing API/network failures.
test("price history distinguishes removed products and merchants and sanitizes API/network failures", async (t) => {
  for (const [status, code] of [
    [400, "invalid_analytics_query"],
    [404, "product_not_found"],
    [404, "merchant_not_found"],
    [404, "unexpected_response"],
    [422, "analytics_mixed_currencies"],
    [500, "analytics_price_history_failed"],
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json(
        { error: code === "unexpected_response" ? "private details" : code },
        { status },
      ),
    );
    await assert.rejects(getPriceHistory(17, ""), { code, message: code });
  }
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(getPriceHistory(id, ""), {
      code: "invalid_analytics_query",
    });
  t.mock.method(globalThis, "fetch", async () => new Response("invalid json"));
  await assert.rejects(getPriceHistory(17, ""), {
    code: "unexpected_response",
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("private details");
  });
  await assert.rejects(getPriceHistory(17, ""), { code: "network_error" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getPriceHistory(17, "", controller.signal), {
    name: "AbortError",
  });
});

// Tests for the price chart points generation, ensuring correct handling of missing, zero, negative, and same-day prices.
test("chart points omit missing prices, keep zero/negative values and preserve gaps and same-day purchases", () => {
  const points = priceChartPoints(data.history);
  assert.deepEqual(
    points.map((point) => point.y),
    [101, 0, 200],
  );
  assert.equal(points[1].x - points[0].x, 10);
  assert.equal(points[1].x, points[2].x);
  assert.equal(points[0].x * DAY_MS, Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(points[2].purchase.receiptId, 13);
  assert.equal(points[0].purchase, purchase);
  assert.deepEqual(priceChartPoints([]), []);
  assert.deepEqual(
    priceChartPoints([{ ...purchase, unitPriceCents: null }]),
    [],
  );
  assert.equal(
    priceChartPoints([{ ...purchase, unitPriceCents: -50 }])[0].y,
    -50,
  );
});
