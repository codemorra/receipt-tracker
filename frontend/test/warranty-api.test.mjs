import assert from "node:assert/strict";
import test from "node:test";
import { getWarranties, WarrantyApiError } from "../src/api/warranty-api.ts";

function listing(page, totalItems = 41) {
  const offset = (page - 1) * 20;
  return {
    items: Array.from(
      { length: Math.max(0, Math.min(20, totalItems - offset)) },
      (_, index) => ({
        id: offset + index + 1,
        receiptId: 2,
        receiptItemId: 3,
        type: "manufacturer",
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        status: "active",
        displayName: "Toaster",
        merchantName: "Shop",
        purchaseDate: "2026-01-01",
      }),
    ),
    page: totalItems === 0 ? 1 : page,
    pageSize: 20,
    totalItems,
    totalPages: Math.ceil(totalItems / 20),
  };
}

// Tests for the warranty API, including encoding of filters, pagination handling, and error scenarios.
test("warranty API encodes filters and preserves full, partial, empty and out-of-range pages", async (t) => {
  const controller = new AbortController();
  for (const [page, totalItems] of [
    [1, 41],
    [2, 41],
    [3, 41],
    [4, 41],
    [9, 0],
  ]) {
    const data = listing(page, totalItems);
    t.mock.method(globalThis, "fetch", async (path, init) => {
      const url = new URL(path, "http://localhost");
      assert.equal(url.pathname, "/api/warranties");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        search: "Test's & Söhne",
        page: String(page),
        status: "active",
        type: "manufacturer",
      });
      assert.equal(init.cache, "no-store");
      assert.equal(init.signal, controller.signal);
      return Response.json(data);
    });
    assert.deepEqual(
      await getWarranties(
        {
          search: "  Test's & Söhne  ",
          page,
          status: "active",
          type: "manufacturer",
        },
        controller.signal,
      ),
      data,
    );
  }
  t.mock.method(globalThis, "fetch", async (path) => {
    assert.equal(path, "/api/warranties?search=&page=1");
    return Response.json(listing(1, 0));
  });
  assert.deepEqual(await getWarranties(), listing(1, 0));
});

// Tests for the warranty API handling of invalid responses, inconsistent pagination, and invalid query values.
test("warranty API rejects invalid rows, inconsistent pagination and invalid query values", async (t) => {
  const invalid = [
    null,
    { ...listing(1), pageSize: 50 },
    { ...listing(1), totalItems: -1 },
    { ...listing(1), totalPages: 2 },
    { ...listing(1), items: [] },
    listing(2),
    { ...listing(1, 0), page: 2 },
    { ...listing(4), items: [listing(1).items[0]] },
    { ...listing(1), items: Array(20).fill(listing(1).items[0]) },
    ...[
      { id: 0 },
      { receiptId: null },
      { receiptItemId: -1 },
      { type: "unknown" },
      { status: "unknown" },
      { startDate: "2026-02-30" },
      { endDate: "2025-12-31" },
      { purchaseDate: "not-a-date" },
      { displayName: null },
      { merchantName: null },
    ].map((changes) => {
      const data = listing(1);
      data.items[0] = { ...data.items[0], ...changes };
      return data;
    }),
  ];
  for (const data of invalid) {
    t.mock.method(globalThis, "fetch", async () => Response.json(data));
    await assert.rejects(getWarranties(), { code: "unexpected_response" });
  }
  for (const query of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: Number.MAX_SAFE_INTEGER + 1 },
    { status: "unknown" },
    { type: "unknown" },
  ]) {
    await assert.rejects(getWarranties(query), {
      code: "invalid_warranty_query",
    });
  }
  // All four server status values are accepted without recalculating them locally.
  for (const status of ["active", "not_started", "expiring_soon", "expired"]) {
    const data = listing(1, 1);
    data.items[0].status = status;
    t.mock.method(globalThis, "fetch", async () => Response.json(data));
    assert.deepEqual(await getWarranties(), data);
  }
});

// Tests for the warranty API handling of server failures and request cancellations.
test("warranty API sanitizes failures and preserves cancellation during fetch and body reading", async (t) => {
  for (const [response, code] of [
    [
      Response.json({ error: "private details" }, { status: 400 }),
      "invalid_warranty_query",
    ],
    [
      Response.json({ error: "private details" }, { status: 500 }),
      "warranty_list_failed",
    ],
    [new Response("invalid JSON"), "unexpected_response"],
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      getWarranties(),
      (error) =>
        error instanceof WarrantyApiError &&
        error.code === code &&
        !error.message.includes("private"),
    );
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("private details");
  });
  await assert.rejects(getWarranties(), { code: "network_error" });
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(getWarranties({}, aborted.signal), {
    name: "AbortError",
  });
  for (const phase of ["fetch", "body"]) {
    const controller = new AbortController();
    t.mock.method(globalThis, "fetch", async () => {
      if (phase === "fetch") {
        controller.abort();
        controller.signal.throwIfAborted();
      }
      return {
        ok: true,
        async json() {
          controller.abort();
          controller.signal.throwIfAborted();
        },
      };
    });
    await assert.rejects(getWarranties({}, controller.signal), {
      name: "AbortError",
    });
  }
});
