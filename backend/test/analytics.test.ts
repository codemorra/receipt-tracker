import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import { loadSpending, SpendingError } from "../src/analytics/spending.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";

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
    "from=",
    "to=",
    "from=2026-02-30",
    "from=2025-02-29",
    "to=2026-13-01",
    "from=2026-1-01",
    "from=2026-01-01T00:00:00Z",
    "from=2026-01-02&to=2026-01-01",
    "merchantId=",
    "merchantId=0",
    "merchantId=-1",
    "merchantId=1.5",
    "merchantId=1e0",
    "merchantId=9007199254740992",
    "merchantId=abc",
    "merchantId=1&merchantId=2",
    "from=2026-01-01&from=2026-01-02",
    "from[x]=2026-01-01",
    "merchantId[x]=1",
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
