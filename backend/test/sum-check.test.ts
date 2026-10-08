import assert from "node:assert/strict";
import test from "node:test";
import type { ReceiptExtraction } from "../src/extraction/receipt-extraction.js";
import { checkReceiptSum } from "../src/review/sum-check.js";

// Tests for the receipt sum check functionality.
const extraction: ReceiptExtraction = {
  merchant: { rawName: "TEST MARKET", normalizedName: "Test Market" },
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  currency: "EUR",
  totalCents: 319,
  items: [
    {
      rawName: "Milk",
      normalizedName: "Milk",
      brand: null,
      productGroup: null,
      category: null,
      packageAmount: null,
      packageUnit: null,
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 119,
      totalPriceCents: 119,
      lineType: "product",
      sourceLineIndexes: [0],
    },
    {
      rawName: "Bread",
      normalizedName: "Bread",
      brand: null,
      productGroup: null,
      category: null,
      packageAmount: null,
      packageUnit: null,
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 250,
      totalPriceCents: 250,
      lineType: "product",
      sourceLineIndexes: [1],
    },
  ],
  discounts: [
    {
      rawName: "Discount",
      description: null,
      amountCents: 50,
      appliesToItemIndex: null,
      sourceLineIndexes: [2],
    },
  ],
};

// Test for the sum check including discounts and rounding tolerance.
test("sum check includes discounts and allows one cent rounding", () => {
  assert.deepEqual(checkReceiptSum(extraction), {
    status: "MATCH",
    itemSumCents: 369,
    discountSumCents: 50,
    differenceCents: 0,
  });
  assert.equal(
    checkReceiptSum({ ...extraction, totalCents: 318 }).status,
    "MATCH",
  );
  assert.equal(
    checkReceiptSum({ ...extraction, totalCents: 318 }, 0).status,
    "MISMATCH",
  );
});

// Test for handling sum mismatches and negative deposit returns.
test("sum mismatches warn without rejecting negative deposit returns", () => {
  const result = checkReceiptSum({ ...extraction, totalCents: 300 });
  assert.deepEqual(result, {
    status: "MISMATCH",
    itemSumCents: 369,
    discountSumCents: 50,
    differenceCents: 19,
  });
  const depositReturn = {
    ...extraction.items[0],
    rawName: "Deposit return",
    totalPriceCents: -25,
    lineType: "deposit" as const,
  };
  assert.equal(
    checkReceiptSum({
      ...extraction,
      items: [...extraction.items, depositReturn],
      totalCents: 294,
    }).status,
    "MATCH",
  );
});

// Test for reporting incomplete values instead of a false mismatch.
test("sum check reports incomplete values instead of a false mismatch", () => {
  assert.equal(
    checkReceiptSum({ ...extraction, totalCents: null }).status,
    "INCOMPLETE",
  );
  assert.deepEqual(
    checkReceiptSum({
      ...extraction,
      items: [{ ...extraction.items[0], totalPriceCents: null }],
    }),
    {
      status: "INCOMPLETE",
      itemSumCents: null,
      discountSumCents: 50,
      differenceCents: null,
    },
  );
});
