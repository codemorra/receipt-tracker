import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import { normalizeAlias } from "../src/matching/alias-normalizer.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";
import { listWarranties } from "../src/warranties/warranty-listing.js";
import { warrantyStatus } from "../src/warranties/warranty-status.js";

const TODAY = "2026-10-07";
function fixture(t: TestContext) {
  const data = createDatabase(":memory:");
  t.after(() => data.sqlite.close());
  data.sqlite.exec(`
    INSERT INTO merchant (id, name, created_at, updated_at) VALUES (1, 'Shop', 'now', 'now');
    INSERT INTO product_group (id, category_id, name, created_at, updated_at)
      VALUES (1, (SELECT id FROM category LIMIT 1), 'Appliances', 'now', 'now');
    INSERT INTO product (id, product_group_id, name, created_at, updated_at)
      VALUES (1, 1, 'Süßer Toaster', 'now', 'now');
    INSERT INTO receipt (id, merchant_id, purchase_date, total_cents, currency, image_path, created_at, updated_at)
      VALUES (1, 1, '2026-01-01', 1000, 'EUR', 'unused.webp', 'now', 'now');
  `);
  for (const alias of ["TOAST-17", "TOAST-18"]) {
    data.sqlite
      .prepare(
        "INSERT INTO product_alias (product_id, alias, normalized_alias, created_at) VALUES (1, ?, ?, 'now')",
      )
      .run(alias, normalizeAlias(alias));
  }
  const item = data.sqlite.prepare(`INSERT INTO receipt_item
    (receipt_id, product_id, position, raw_name, quantity, total_price_cents, line_type, created_at, updated_at)
    VALUES (1, ?, ?, ?, 1, 1000, 'product', 'now', 'now')`);
  const productItem = Number(item.run(1, 1, "Receipt label").lastInsertRowid);
  const fallbackItem = Number(
    item.run(null, 2, "Fallback Gerät").lastInsertRowid,
  );
  item.run(1, 3, "No warranty");
  const insert = data.sqlite.prepare(`INSERT INTO warranty
    (receipt_item_id, type, start_date, end_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'now', 'now')`);
  function warranty(
    start: string,
    end: string,
    type = "manufacturer",
    itemId = productItem,
  ) {
    return Number(insert.run(itemId, type, start, end).lastInsertRowid);
  }
  return { ...data, productItem, fallbackItem, warranty };
}

// Test suite for listing warranties based on various query parameters and pagination.
test("listing reuses canonical/alias search, filters stored intervals and orders each status deterministically", (t) => {
  const data = fixture(t);
  const active = data.warranty("2026-01-01", "2026-11-07");
  const expiredOld = data.warranty("2026-01-01", "2026-09-01");
  const futureLater = data.warranty("2026-12-01", "2027-01-01");
  const soon = data.warranty(TODAY, TODAY, "statutory");
  const expiredRecent = data.warranty("2026-01-01", "2026-10-06");
  const future = data.warranty("2026-11-01", "2027-02-01");
  const boundary = data.warranty("2026-01-01", "2026-11-06", "extended");
  const tied = data.warranty("2026-01-01", "2026-11-06", "extended");
  const fallback = data.warranty(
    TODAY,
    "2026-11-08",
    "manufacturer",
    data.fallbackItem,
  );
  const expected = [
    soon,
    boundary,
    tied,
    active,
    fallback,
    future,
    futureLater,
    expiredRecent,
    expiredOld,
  ];
  const all = listWarranties(data.db, {}, TODAY);
  assert.deepEqual(
    all.items.map((row) => row.id),
    expected,
  );
  assert.equal(all.totalItems, 9);
  for (const row of all.items) {
    assert.equal(row.status, warrantyStatus(row.startDate, row.endDate, TODAY));
  }
  assert.deepEqual(all.items[0], {
    id: soon,
    receiptId: 1,
    receiptItemId: data.productItem,
    type: "statutory",
    startDate: TODAY,
    endDate: TODAY,
    status: "expiring_soon",
    displayName: "Süßer Toaster",
    merchantName: "Shop",
    purchaseDate: "2026-01-01",
  });
  const canonicalIds = expected.filter((id) => id !== fallback);
  for (const search of ["  SÜSSER TOASTER ", "toast", "TOAST-17"]) {
    const result = listWarranties(data.db, { search }, TODAY);
    assert.deepEqual(
      result.items.map((row) => row.id),
      canonicalIds,
    );
    assert.equal(result.totalItems, canonicalIds.length);
  }
  assert.equal(
    listWarranties(data.db, { search: "fallback geraet" }, TODAY).items[0]
      .displayName,
    "Fallback Gerät",
  );
  for (const query of [
    { status: "active" as const },
    { status: "not_started" as const },
    { status: "expired" as const },
    { status: "expiring_soon" as const },
    { type: "statutory" as const },
    { type: "manufacturer" as const },
    { type: "extended" as const },
    {
      search: "toast",
      status: "expiring_soon" as const,
      type: "extended" as const,
    },
  ]) {
    const filtered = all.items.filter(
      (row) =>
        (!query.status || row.status === query.status) &&
        (!query.type || row.type === query.type) &&
        (!query.search || row.id !== fallback),
    );
    const result = listWarranties(data.db, query, TODAY);
    assert.deepEqual(result.items, filtered);
    assert.equal(result.totalItems, filtered.length);
  }
  for (const search of ["missing", "%_", "' OR 1=1 --", "Shop"]) {
    assert.deepEqual(listWarranties(data.db, { search, page: 9 }, TODAY), {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });
  }
});

// Test suite for pagination behavior when listing warranties.
test("pagination counts intervals without multiplying aliases and handles empty and huge pages", (t) => {
  const data = fixture(t);
  assert.equal(listWarranties(data.db, {}, TODAY).totalItems, 0);
  const ids = Array.from({ length: 41 }, () =>
    data.warranty(TODAY, "2027-01-01"),
  );
  for (const page of [1, 2, 3, 4, Number.MAX_SAFE_INTEGER]) {
    const result = listWarranties(data.db, { search: "toast", page }, TODAY);
    assert.deepEqual(
      result.items.map((row) => row.id),
      page > 3 ? [] : ids.slice((page - 1) * 20, page * 20),
    );
    assert.deepEqual(
      { ...result, items: [] },
      { items: [], page, pageSize: 20, totalItems: 41, totalPages: 3 },
    );
  }
});

// Test suite for HTTP API endpoints related to listing warranties.
test("HTTP listing validates queries, returns saved intervals and sanitizes database failures", async (t) => {
  const data = fixture(t);
  const events: string[] = [];
  const scans = new ScanSessionService("/unused", {
    async requestPreview() {
      throw new Error("unused");
    },
    async requestProcess() {
      throw new Error("unused");
    },
  });
  const app = createApp(
    scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("unused");
      },
    }),
    "/unused",
    (_level, operation) => {
      events.push(operation);
    },
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/warranties`;
  assert.deepEqual(await (await fetch(`${url}?page=9`)).json(), {
    items: [],
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  for (const query of [
    "page=0",
    "page=-1",
    "page=abc",
    "page=",
    "page=1.5",
    "page=1e2",
    "page=9007199254740992",
    "page=1&page=2",
    "search=a&search=b",
    "status=unknown",
    "status=active&status=expired",
    "type=unknown",
    "type=extended&type=statutory",
  ]) {
    const response = await fetch(`${url}?${query}`);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      error: "invalid_warranty_query",
    });
  }
  const id = data.warranty("2000-01-01", "2000-01-01", "extended");
  const response = await fetch(
    `${url}?search=toast&type=extended&status=expired`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    listWarranties(data.db, {
      search: "toast",
      type: "extended",
      status: "expired",
    }),
  );
  assert.equal(listWarranties(data.db).items[0].id, id);
  data.sqlite.exec("ALTER TABLE warranty RENAME TO unavailable_warranty");
  const failed = await fetch(url);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "warranty_list_failed" });
  assert.deepEqual(events, ["warranty.list.failed"]);
});
