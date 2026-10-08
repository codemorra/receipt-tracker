import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import {
  spendingQuerySchema,
  priceHistoryQuerySchema,
} from "../src/analytics/analytics-query.js";
import { loadSpending, SpendingError } from "../src/analytics/spending.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";
import {
  loadPriceHistory,
  PriceHistoryError,
} from "../src/analytics/price-history.js";

/**
 * Sets up a test fixture with an in-memory database and helper functions.
 * @param t The test context.
 * @returns An object containing the database instance and helper functions.
 */
function fixture(t: TestContext) {
  const database = createDatabase(":memory:");
  t.after(() => database.sqlite.close());
  const { sqlite } = database;
  const insertMerchant = sqlite.prepare(
    "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, 'now', 'now')",
  );
  const first = Number(insertMerchant.run("Alpha").lastInsertRowid);
  const second = Number(insertMerchant.run("Beta").lastInsertRowid);
  const empty = Number(insertMerchant.run("Empty").lastInsertRowid);
  const insertReceipt = sqlite.prepare(
    "INSERT INTO receipt (merchant_id, purchase_date, total_cents, currency, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, 'unused.webp', 'now', 'now')",
  );
  function receipt(
    date: string,
    cents: number,
    merchantId = first,
    currency = "EUR",
  ) {
    return Number(
      insertReceipt.run(merchantId, date, cents, currency).lastInsertRowid,
    );
  }
  return { ...database, first, second, empty, receipt };
}

/**
 * Sets up a test fixture with an in-memory database and helper functions for price history tests.
 * @param t The test context.
 * @returns An object containing the database instance and helper functions, along with product and item helpers.
 */
function priceFixture(t: TestContext) {
  const data = fixture(t);
  const brandId = Number(
    data.sqlite
      .prepare(
        "INSERT INTO brand (name, created_at, updated_at) VALUES ('Brand', 'now', 'now')",
      )
      .run().lastInsertRowid,
  );
  const groupId = Number(
    data.sqlite
      .prepare(
        "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES ((SELECT id FROM category LIMIT 1), 'Milk', 'now', 'now')",
      )
      .run().lastInsertRowid,
  );
  const insertProduct = data.sqlite.prepare(
    "INSERT INTO product (product_group_id, brand_id, name, package_amount, package_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'now', 'now')",
  );
  const productId = Number(
    insertProduct.run(groupId, brandId, "Whole Milk", 1, "l").lastInsertRowid,
  );
  const otherProductId = Number(
    insertProduct.run(groupId, null, "Other Milk", null, null).lastInsertRowid,
  );
  const emptyProductId = Number(
    insertProduct.run(groupId, null, "Unused Milk", null, null).lastInsertRowid,
  );
  const insertItem = data.sqlite.prepare(
    "INSERT INTO receipt_item (receipt_id, product_id, position, raw_name, quantity, unit_price_cents, total_price_cents, line_type, created_at, updated_at) VALUES (?, ?, ?, 'raw', ?, ?, 9999, 'product', 'now', 'now')",
  );
  function item(
    receiptId: number,
    cents: number | null,
    position = 0,
    product = productId,
    quantity = 1,
  ) {
    return Number(
      insertItem.run(receiptId, product, position, quantity, cents)
        .lastInsertRowid,
    );
  }
  return { ...data, productId, otherProductId, emptyProductId, item };
}

// Test for verifying the price history analytics functionality.
test("price history filters saved product observations by merchant and inclusive dates without quantity weighting", (t) => {
  const data = priceFixture(t);
  data.item(data.receipt("2026-01-01", 1000), 999);
  const firstReceipt = data.receipt("2026-01-02", 1000);
  const firstItem = data.item(firstReceipt, 101, 1, data.productId, 2);
  const missingItem = data.item(firstReceipt, null, 0);
  const secondItem = data.item(
    data.receipt("2026-01-03", 1000, data.second),
    200,
    0,
    data.productId,
    3,
  );
  const thirdItem = data.item(data.receipt("2026-01-04", 1000), 300);
  const lastMissingItem = data.item(data.receipt("2026-01-05", 1000), null);
  data.item(data.receipt("2026-01-03", 1000), 1, 0, data.otherProductId);
  data.item(data.receipt("2026-01-06", 1000), 888);
  const base = {
    productId: data.productId,
    from: "2026-01-02",
    to: "2026-01-05",
  };
  for (const [query, ids, prices] of [
    [
      base,
      [missingItem, firstItem, secondItem, thirdItem, lastMissingItem],
      [300, 101, 300, 200],
    ],
    [
      { ...base, merchantId: data.first },
      [missingItem, firstItem, thirdItem, lastMissingItem],
      [300, 101, 300, 201],
    ],
    [{ ...base, merchantId: data.second }, [secondItem], [200, 200, 200, 200]],
    [
      { ...base, to: "2026-01-02" },
      [missingItem, firstItem],
      [101, 101, 101, 101],
    ],
    [
      { productId: data.productId, from: "2026-01-04", to: "2026-01-05" },
      [thirdItem, lastMissingItem],
      [300, 300, 300, 300],
    ],
  ] as const) {
    const result = loadPriceHistory(data.db, query);
    assert.equal(result.currency, "EUR");
    assert.deepEqual(
      result.history.map((row) => row.receiptItemId),
      ids,
    );
    assert.deepEqual(result.statistics, {
      latestCents: prices[0],
      minimumCents: prices[1],
      maximumCents: prices[2],
      averageCents: prices[3],
    });
    assert.deepEqual(result.product, {
      id: data.productId,
      name: "Whole Milk",
      brandName: "Brand",
      productGroupName: "Milk",
      packageAmount: 1,
      packageUnit: "l",
    });
  }
  const first = loadPriceHistory(data.db, base).history[1];
  assert.deepEqual(first, {
    receiptItemId: firstItem,
    receiptId: firstReceipt,
    purchaseDate: "2026-01-02",
    purchaseTime: null,
    merchantId: data.first,
    merchantName: "Alpha",
    currency: "EUR",
    unitPriceCents: 101,
    quantity: 2,
  });
  assert.equal(
    loadPriceHistory(data.db, { productId: data.otherProductId }).history
      .length,
    1,
  );
  assert.equal(
    loadPriceHistory(data.db, { productId: data.productId, to: "2026-01-02" })
      .history.length,
    3,
  );
  assert.equal(
    loadPriceHistory(data.db, { productId: data.productId, from: "2026-01-06" })
      .statistics.latestCents,
    888,
  );
});

// Test for verifying the ordering of same-day purchases in the price history analytics.
test("price history orders same-day purchases by time, receipt ID, item position and item ID", (t) => {
  const data = priceFixture(t);
  const late = data.receipt("2026-01-02", 100);
  data.sqlite
    .prepare("UPDATE receipt SET purchase_time = '16:00' WHERE id = ?")
    .run(late);
  const lateItem = data.item(late, 40);
  const noTime = data.receipt("2026-01-02", 100);
  const noTimeItem = data.item(noTime, 10);
  const early = data.receipt("2026-01-02", 100);
  data.sqlite
    .prepare("UPDATE receipt SET purchase_time = '09:00' WHERE id = ?")
    .run(early);
  const positionOne = data.item(early, 30, 1);
  const positionZero = data.item(early, 20, 0);
  const samePosition = data.item(early, 25, 0);
  const sameTime = data.receipt("2026-01-02", 100);
  data.sqlite
    .prepare("UPDATE receipt SET purchase_time = '09:00' WHERE id = ?")
    .run(sameTime);
  const sameTimeItem = data.item(sameTime, 35);
  const newestMissing = data.item(data.receipt("2026-01-03", 100), null);
  const result = loadPriceHistory(data.db, { productId: data.productId });
  assert.deepEqual(
    result.history.map((row) => row.receiptItemId),
    [
      noTimeItem,
      positionZero,
      samePosition,
      positionOne,
      sameTimeItem,
      lateItem,
      newestMissing,
    ],
  );
  assert.equal(result.statistics.latestCents, 40);
});

// Test for verifying the behavior of the price history analytics when no valid observations exist.
test("price history retains metadata and missing prices when no valid observations exist", (t) => {
  const data = priceFixture(t);
  data.item(data.receipt("2026-01-02", 100, data.first, "EUR"), null);
  data.item(data.receipt("2026-01-03", 100, data.second, "USD"), null);
  for (const query of [
    { productId: data.emptyProductId },
    { productId: data.productId, from: "2027-01-01" },
    { productId: data.productId, merchantId: data.empty },
    { productId: data.productId },
  ]) {
    const result = loadPriceHistory(data.db, query);
    assert.equal(result.currency, null);
    assert.deepEqual(result.statistics, {
      latestCents: null,
      minimumCents: null,
      maximumCents: null,
      averageCents: null,
    });
    assert.equal(result.product.id, query.productId);
    assert.equal(
      result.history.length,
      Object.keys(query).length === 1 && query.productId === data.productId
        ? 2
        : 0,
    );
  }
  assert.deepEqual(
    loadPriceHistory(data.db, { productId: data.emptyProductId }).product,
    {
      id: data.emptyProductId,
      name: "Unused Milk",
      brandName: null,
      productGroupName: "Milk",
      packageAmount: null,
      packageUnit: null,
    },
  );
});

// Test for verifying that the price statistics correctly handle zero and negative unit prices and reject only mixed valid currencies.
test("price statistics preserve zero and negative unit prices and reject only mixed valid currencies", (t) => {
  const data = priceFixture(t);
  const firstReceipt = data.receipt("2026-01-01", 999);
  data.item(firstReceipt, -1);
  data.item(firstReceipt, 0, 1);
  data.item(data.receipt("2026-01-02", 999, data.second, "USD"), null);
  const result = loadPriceHistory(data.db, { productId: data.productId });
  assert.equal(result.currency, "EUR");
  assert.deepEqual(result.statistics, {
    latestCents: 0,
    minimumCents: -1,
    maximumCents: 0,
    averageCents: -1,
  });
  const otherCurrencyReceipt = data.receipt(
    "2026-01-03",
    999,
    data.second,
    "USD",
  );
  data.item(otherCurrencyReceipt, 100);
  assert.throws(
    () => loadPriceHistory(data.db, { productId: data.productId }),
    (error) =>
      error instanceof PriceHistoryError &&
      error.code === "analytics_mixed_currencies",
  );
  assert.equal(
    loadPriceHistory(data.db, {
      productId: data.productId,
      merchantId: data.second,
    }).currency,
    "USD",
  );
  assert.equal(
    loadPriceHistory(data.db, { productId: data.productId, to: "2026-01-01" })
      .currency,
    "EUR",
  );
});

// Shared filter rules belong at the schema boundary; routes retain HTTP wiring checks.
test("analytics queries validate calendar ranges and positive safe identifiers", () => {
  assert.deepEqual(spendingQuerySchema.parse({}), {});
  assert.deepEqual(
    spendingQuerySchema.parse({
      from: "2024-02-29",
      to: "2024-02-29",
      merchantId: "7",
    }),
    { from: "2024-02-29", to: "2024-02-29", merchantId: 7 },
  );
  for (const query of [
    { from: "" },
    { to: "" },
    { from: "2026-02-30" },
    { from: "2025-02-29" },
    { to: "2026-13-01" },
    { from: "2026-1-01" },
    { from: "2026-01-01T00:00:00Z" },
    { from: "2026-01-02", to: "2026-01-01" },
    { from: ["2026-01-01", "2026-01-02"] },
    { from: { x: "2026-01-01" } },
  ]) {
    assert.equal(
      spendingQuerySchema.safeParse(query).success,
      false,
      JSON.stringify(query),
    );
  }
  // Both ID fields use the same identifier schema.
  for (const value of [
    "",
    "0",
    "1.5",
    "1e0",
    "9007199254740992",
    "abc",
    ["1", "2"],
    { x: "1" },
  ]) {
    assert.equal(
      spendingQuerySchema.safeParse({ merchantId: value }).success,
      false,
      JSON.stringify(value),
    );
  }
  assert.deepEqual(priceHistoryQuerySchema.parse({ productId: "17" }), {
    productId: 17,
  });
  assert.equal(priceHistoryQuerySchema.safeParse({}).success, false);
});

// Test for verifying the HTTP contract of the price history analytics endpoint, including validation of IDs and dates, and handling of missing products, merchants, and currencies.
test("price history HTTP contract validates IDs and dates and distinguishes missing products, merchants and currencies", async (t) => {
  const data = priceFixture(t);
  const scans = new ScanSessionService("/tmp/unused-price-history-scans", {
    async requestPreview() {
      throw new Error("Unexpected preview");
    },
    async requestProcess() {
      throw new Error("Unexpected process");
    },
  });
  const logs: string[] = [];
  const app = createApp(
    scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("Unexpected extraction");
      },
    }),
    "/tmp/unused-price-history-data",
    (_level, operation) => logs.push(operation),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const get = (query: string) =>
    fetch(
      `http://127.0.0.1:${address.port}/api/analytics/price-history?${query}`,
    );
  data.item(data.receipt("2026-01-01", 999), 101);
  const valid = await get(
    `productId=${data.productId}&from=2026-01-01&to=2026-01-01&merchantId=${data.first}`,
  );
  assert.equal(valid.status, 200);
  assert.deepEqual(
    await valid.json(),
    loadPriceHistory(data.db, {
      productId: data.productId,
      from: "2026-01-01",
      to: "2026-01-01",
      merchantId: data.first,
    }),
  );
  for (const query of [
    "", // Required product ID.
    "productId=0", // The product ID uses the shared identifier validator.
    "productId=1&productId=2", // Express query arrays.
    "productId[x]=1", // Express query objects.
    `productId=${data.productId}&merchantId=0`, // Shared optional filters.
    `productId=${data.productId}&from=2026-02-30`,
    `productId=${data.productId}&from=2026-01-02&to=2026-01-01`,
  ]) {
    const response = await get(query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      error: "invalid_analytics_query",
    });
  }
  for (const [query, code] of [
    ["productId=999999", "product_not_found"],
    [`productId=${data.productId}&merchantId=999999`, "merchant_not_found"],
  ]) {
    const response = await get(query);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: code });
  }
  const empty = await get(`productId=${data.emptyProductId}`);
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).history, []);
  data.item(data.receipt("2026-01-02", 999, data.second, "USD"), 200);
  const mixed = await get(`productId=${data.productId}`);
  assert.equal(mixed.status, 422);
  assert.deepEqual(await mixed.json(), { error: "analytics_mixed_currencies" });
  data.sqlite.prepare("DROP TABLE warranty").run();
  data.sqlite.prepare("DROP TABLE discount").run();
  data.sqlite.prepare("DROP TABLE receipt_item").run();
  const failed = await get(`productId=${data.productId}`);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: "analytics_price_history_failed",
  });
  assert.deepEqual(logs, ["analytics.price_history.failed"]);
});

// Test cases for the spending analytics functionality.
test("spending uses final receipt totals and shared inclusive date/merchant filters", (t) => {
  const data = fixture(t);
  data.receipt("2026-01-01", 999);
  const id = data.receipt("2026-01-02", 101);
  data.receipt("2026-01-03", 200, data.second);
  data.receipt("2026-01-04", 400);
  data.receipt("2026-01-05", 999);
  // Deliberately different item totals and discounts must not affect spending or multiply receipts.
  for (const position of [0, 1]) {
    data.sqlite
      .prepare(
        "INSERT INTO receipt_item (receipt_id, position, raw_name, quantity, unit_price_cents, total_price_cents, line_type, created_at, updated_at) VALUES (?, ?, 'item', 2, 500, 1000, 'other', 'now', 'now')",
      )
      .run(id, position);
  }
  data.sqlite
    .prepare(
      "INSERT INTO discount (receipt_id, amount_cents, created_at) VALUES (?, 20, 'now')",
    )
    .run(id);

  for (const entry of [
    {
      query: { from: "2026-01-02", to: "2026-01-04" },
      total: 701,
      count: 3,
      average: 234,
      merchants: [data.first, data.second],
    },
    {
      query: { from: "2026-01-02", to: "2026-01-04", merchantId: data.first },
      total: 501,
      count: 2,
      average: 251,
      merchants: [data.first],
    },
    {
      query: { from: "2026-01-03", to: "2026-01-03" },
      total: 200,
      count: 1,
      average: 200,
      merchants: [data.second],
    },
    {
      query: { from: "2026-01-04" },
      total: 1399,
      count: 2,
      average: 700,
      merchants: [data.first],
    },
    {
      query: { to: "2026-01-02" },
      total: 1100,
      count: 2,
      average: 550,
      merchants: [data.first],
    },
    {
      query: {},
      total: 2699,
      count: 5,
      average: 540,
      merchants: [data.first, data.second],
    },
  ]) {
    const result = loadSpending(data.db, entry.query);
    assert.equal(result.currency, "EUR");
    assert.deepEqual(result.summary, {
      totalCents: entry.total,
      receiptCount: entry.count,
      averageReceiptCents: entry.average,
    });
    assert.deepEqual(
      result.merchants.map((row) => row.merchantId),
      entry.merchants,
    );
    for (const rows of [result.timeline, result.merchants]) {
      assert.equal(
        rows.reduce((sum, row) => sum + row.totalCents, 0),
        entry.total,
      );
      assert.equal(
        rows.reduce((sum, row) => sum + row.receiptCount, 0),
        entry.count,
      );
    }
  }
  assert.deepEqual(
    loadSpending(data.db, { from: "2026-01-02", to: "2026-01-04" }).merchants,
    [
      {
        merchantId: data.first,
        name: "Alpha",
        receiptCount: 2,
        totalCents: 501,
      },
      {
        merchantId: data.second,
        name: "Beta",
        receiptCount: 1,
        totalCents: 200,
      },
    ],
  );
});

// Test case for verifying the behavior of the spending timeline with different granularities and empty periods.
test("spending timeline switches at 45/183 days and fills empty daily, Monday-weekly and monthly buckets", (t) => {
  const data = fixture(t);
  data.receipt("2026-01-04", 100); // Sunday: bucket starts in the previous year.
  data.receipt("2026-01-05", 200);
  data.receipt("2026-01-19", 300);
  data.receipt("2026-03-01", 400);
  for (const [to, granularity, length] of [
    ["2026-02-14", "daily", 45],
    ["2026-02-15", "weekly", 7],
    ["2026-07-02", "weekly", 27],
    ["2026-07-03", "monthly", 7],
  ] as const) {
    const result = loadSpending(data.db, { from: "2026-01-01", to });
    assert.equal(result.granularity, granularity);
    assert.equal(result.timeline.length, length);
    assert.ok(
      result.timeline.some(
        (row) => row.totalCents === 0 && row.receiptCount === 0,
      ),
    );
    assert.equal(
      result.timeline.reduce((sum, row) => sum + row.totalCents, 0),
      result.summary.totalCents,
    );
  }
  const weekly = loadSpending(data.db, {
    from: "2026-01-01",
    to: "2026-02-15",
  });
  assert.deepEqual(weekly.timeline.slice(0, 4), [
    { period: "2025-12-29", totalCents: 100, receiptCount: 1 },
    { period: "2026-01-05", totalCents: 200, receiptCount: 1 },
    { period: "2026-01-12", totalCents: 0, receiptCount: 0 },
    { period: "2026-01-19", totalCents: 300, receiptCount: 1 },
  ]);
  const monthly = loadSpending(data.db, {
    from: "2026-01-05",
    to: "2026-08-01",
  });
  assert.deepEqual(monthly.timeline.slice(0, 3), [
    { period: "2026-01-01", totalCents: 500, receiptCount: 2 },
    { period: "2026-02-01", totalCents: 0, receiptCount: 0 },
    { period: "2026-03-01", totalCents: 400, receiptCount: 1 },
  ]);
  const leap = loadSpending(data.db, { from: "2024-02-28", to: "2024-03-01" });
  assert.deepEqual(
    leap.timeline.map((row) => row.period),
    ["2024-02-28", "2024-02-29", "2024-03-01"],
  );
  const allTime = loadSpending(data.db, {});
  assert.deepEqual(allTime.range, { from: "2026-01-04", to: "2026-03-01" });
  assert.equal(allTime.granularity, "weekly");
});

// Test case for verifying the behavior when there is no spending data.
test("empty spending returns null average and fills only fully known windows", (t) => {
  const data = fixture(t);
  data.receipt("2026-01-01", 100);
  for (const query of [
    { merchantId: data.empty },
    { from: "2027-01-01" },
    { to: "2025-01-01" },
    { from: "2027-01-01", to: "2027-01-02" },
  ]) {
    const result = loadSpending(data.db, query);
    assert.equal(result.currency, null);
    assert.deepEqual(result.summary, {
      totalCents: 0,
      receiptCount: 0,
      averageReceiptCents: null,
    });
    assert.deepEqual(result.merchants, []);
    assert.equal(result.timeline.length, query.from && query.to ? 2 : 0);
  }
  data.sqlite.prepare("DELETE FROM receipt").run();
  assert.deepEqual(loadSpending(data.db, {}).range, { from: null, to: null });
  assert.deepEqual(loadSpending(data.db, {}).timeline, []);
});

// Test case for verifying that spending preserves zero and negative totals and rounds half cents symmetrically.
test("spending preserves zero and negative totals and rounds half cents symmetrically", (t) => {
  const data = fixture(t);
  for (const [cents, expected] of [
    [1, 1],
    [-1, -1],
    [0, 0],
  ] as const) {
    data.sqlite.prepare("DELETE FROM receipt").run();
    data.receipt("2026-01-01", cents);
    data.receipt("2026-01-01", 0);
    const result = loadSpending(data.db, {});
    assert.equal(result.summary.averageReceiptCents, expected);
    assert.equal(result.summary.totalCents, cents);
    assert.equal(result.summary.receiptCount, 2);
  }
});

// Test case for verifying that mixed currencies are rejected only within the selected receipt set.
test("mixed currencies are rejected only within the selected receipt set", (t) => {
  const data = fixture(t);
  data.receipt("2026-01-01", 100);
  data.receipt("2026-01-02", 200, data.second, "USD");
  assert.throws(
    () => loadSpending(data.db, {}),
    (error) =>
      error instanceof SpendingError &&
      error.code === "analytics_mixed_currencies",
  );
  assert.equal(
    loadSpending(data.db, { merchantId: data.second }).currency,
    "USD",
  );
  assert.equal(loadSpending(data.db, { to: "2026-01-01" }).currency, "EUR");
});

// Test case for verifying the HTTP contract of the spending analytics endpoint, including validation of filters and handling of unknown merchants, mixed currencies, and internal failures.
test("spending HTTP contract validates filters and handles unknown merchants, currencies and internal failures", async (t) => {
  const data = fixture(t);
  const scans = new ScanSessionService("/tmp/unused-analytics-scans", {
    async requestPreview() {
      throw new Error("Unexpected preview");
    },
    async requestProcess() {
      throw new Error("Unexpected process");
    },
  });
  const logs: string[] = [];
  const app = createApp(
    scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("Unexpected extraction");
      },
    }),
    "/tmp/unused-analytics-data",
    (_level, operation) => logs.push(operation),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const get = (query = "") =>
    fetch(`http://127.0.0.1:${address.port}/api/analytics/spending${query}`);
  data.receipt("2026-01-01", 101);
  const success = await get(
    `?merchantId=${data.first}&from=2026-01-01&to=2026-01-01`,
  );
  assert.equal(success.status, 200);
  assert.deepEqual(
    await success.json(),
    loadSpending(data.db, {
      merchantId: data.first,
      from: "2026-01-01",
      to: "2026-01-01",
    }),
  );
  for (const query of [
    "from=2026-02-30", // Shared date validation reaches this route.
    "from=2026-01-02&to=2026-01-01", // Range ordering.
    "merchantId=0", // Shared identifier validation.
    "merchantId=1&merchantId=2", // Express query arrays.
    "from[x]=2026-01-01", // Express query objects.
  ]) {
    const response = await get(`?${query}`);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      error: "invalid_analytics_query",
    });
  }
  const missing = await get("?merchantId=999999");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "merchant_not_found" });
  const empty = await get(`?merchantId=${data.empty}`);
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).summary.receiptCount, 0);
  data.receipt("2026-01-02", 200, data.second, "USD");
  const mixed = await get();
  assert.equal(mixed.status, 422);
  assert.deepEqual(await mixed.json(), { error: "analytics_mixed_currencies" });
  data.sqlite.prepare("DROP TABLE discount").run();
  data.sqlite.prepare("DROP TABLE warranty").run();
  data.sqlite.prepare("DROP TABLE receipt_item").run();
  data.sqlite.prepare("DROP TABLE receipt").run();
  const failed = await get();
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "analytics_spending_failed" });
  assert.deepEqual(logs, ["analytics.spending.failed"]);
});
