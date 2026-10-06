import assert from "node:assert/strict";
import test from "node:test";
import { getReceipts, ReceiptApiError } from "../src/api/receipt-api.ts";

/**
 * Generates a mock listing of receipts for testing purposes.
 * @param page - The page number to generate.
 * @param totalItems - The total number of items available (default is 41).
 * @returns A mock receipt list corresponding to the specified page and total items.
 */
function listing(page, totalItems = 41) {
  const offset = (page - 1) * 20;
  return {
    items: Array.from(
      { length: Math.max(0, Math.min(20, totalItems - offset)) },
      (_, index) => ({
        id: offset + index + 1,
        merchantId: 2,
        merchantName: "O'Reilly & Söhne",
        purchaseDate: "2026-09-30",
        purchaseTime: index === 0 ? null : "12:30",
        totalCents: 199,
        currency: "EUR",
        warrantyCount: index === 0 ? 2 : 0,
      }),
    ),
    page: totalItems === 0 ? 1 : page,
    pageSize: 20,
    totalItems,
    totalPages: Math.ceil(totalItems / 20),
  };
}

test("archive API encodes search and accepts full, partial, empty and out-of-range pages", async (t) => {
  const controller = new AbortController();
  for (const [page, totalItems] of [
    [1, 41],
    [2, 41],
    [3, 41],
    [4, 41],
    [9, 0],
  ]) {
    const result = listing(page, totalItems);
    t.mock.method(globalThis, "fetch", async (path, init) => {
      const url = new URL(path, "http://localhost");
      assert.equal(url.pathname, "/api/receipts");
      assert.equal(url.searchParams.get("search"), "O'Reilly & Söhne");
      assert.equal(url.searchParams.get("page"), String(page));
      assert.equal(url.searchParams.has("pageSize"), false);
      assert.equal(init.cache, "no-store");
      assert.equal(init.signal, controller.signal);
      return Response.json(result);
    });
    assert.deepEqual(
      await getReceipts("  O'Reilly & Söhne  ", page, controller.signal),
      result,
    );
  }
});

test("archive API rejects malformed headers and pagination and sanitizes failures", async (t) => {
  const invalid = [
    null,
    { ...listing(1), pageSize: 50 },
    { ...listing(1), totalItems: -1 },
    { ...listing(1), totalPages: 2 },
    { ...listing(1), items: [] },
    { ...listing(4), items: [listing(1).items[0]] },
    { ...listing(1, 0), page: 2 },
    listing(2),
    { ...listing(1), items: Array(20).fill(listing(1).items[0]) },
    ...[
      { id: 0 },
      { merchantName: null },
      { purchaseDate: "2026-02-30" },
      { purchaseTime: "25:00" },
      { totalCents: 1.5 },
      { currency: "EU" },
      { warrantyCount: -1 },
      { warrantyCount: 1.5 },
    ].map((changes) => {
      const result = listing(1);
      result.items[0] = { ...result.items[0], ...changes };
      return result;
    }),
  ];
  for (const result of invalid) {
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    await assert.rejects(getReceipts("", 1), { code: "unexpected_response" });
  }
  for (const page of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(getReceipts("", page), {
      code: "invalid_receipt_query",
    });
  for (const [response, code] of [
    [
      Response.json({ error: "private details" }, { status: 400 }),
      "invalid_receipt_query",
    ],
    [
      Response.json({ error: "private details" }, { status: 500 }),
      "receipt_list_failed",
    ],
    [new Response("invalid JSON"), "unexpected_response"],
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(
      getReceipts(""),
      (error) =>
        error instanceof ReceiptApiError &&
        error.code === code &&
        !error.message.includes("private"),
    );
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("private details");
  });
  await assert.rejects(getReceipts(""), { code: "network_error" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getReceipts("", 1, controller.signal), {
    name: "AbortError",
  });
});
