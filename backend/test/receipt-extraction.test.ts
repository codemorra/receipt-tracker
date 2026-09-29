import assert from "node:assert/strict";
import test from "node:test";
import { createReceiptExtractionSchema } from "../src/extraction/receipt-extraction.js";

// Test data and utility functions for validating receipt extraction schema.
const validExtraction = {
  merchant: { rawName: "EDEKA", normalizedName: "Edeka" },
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  currency: "EUR",
  totalCents: 219,
  items: [
    {
      rawName: "MILCH 1L",
      normalizedName: "Milch",
      brand: null,
      productGroup: "milk",
      category: "food",
      packageAmount: 1,
      packageUnit: "l",
      quantity: 2,
      unit: "pcs",
      unitPriceCents: 119,
      totalPriceCents: 238,
      lineType: "product",
      sourceLineIndexes: [1, 2],
    },
  ],
  discounts: [
    {
      rawName: "RABATT",
      description: null,
      amountCents: 19,
      appliesToItemIndex: 0,
      sourceLineIndexes: [3],
    },
  ],
};

/**
 * Creates a new receipt extraction object by applying the specified changes to the valid extraction.
 * @param changes An object containing the fields to change in the valid extraction.
 * @returns A new receipt extraction object with the applied changes.
 */
function withChanges(changes: Record<string, unknown>) {
  return { ...validExtraction, ...changes };
}

// Test for validating the receipt extraction schema against various scenarios.
test("validates the receipt, item, merchant, and discount contract", () => {
  const schema = createReceiptExtractionSchema(["food"]);
  assert.deepEqual(schema.parse(validExtraction), validExtraction);
  assert.equal(
    schema.safeParse(
      withChanges({
        merchant: { rawName: null, normalizedName: null },
        purchaseDate: null,
        purchaseTime: null,
        currency: null,
        totalCents: null,
        items: [
          {
            ...validExtraction.items[0],
            category: null,
            packageAmount: null,
            packageUnit: null,
            unitPriceCents: null,
            totalPriceCents: null,
          },
        ],
        discounts: [],
      }),
    ).success,
    true,
  );
});

// Test for rejecting categories outside the current reference data and handling warranty fields.
test("rejects categories outside current reference data and warranty fields", () => {
  const schema = createReceiptExtractionSchema(["groceries"]);
  assert.equal(schema.safeParse(validExtraction).success, false);
  assert.equal(
    schema.safeParse({
      ...validExtraction,
      items: [{ ...validExtraction.items[0], category: "groceries" }],
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({ ...validExtraction, warranty: null }).success,
    false,
  );
});

// Test for ensuring discount item indexes are correctly validated after other field checks.
test("checks discount item indexes after field validation", () => {
  const schema = createReceiptExtractionSchema(["food"]);
  const outOfRange = schema.safeParse(
    withChanges({
      discounts: [{ ...validExtraction.discounts[0], appliesToItemIndex: 1 }],
    }),
  );
  assert.equal(outOfRange.success, false);
  if (!outOfRange.success) {
    assert.deepEqual(outOfRange.error.issues[0].path, [
      "discounts",
      0,
      "appliesToItemIndex",
    ]);
  }
  assert.equal(
    schema.safeParse(
      withChanges({
        discounts: [
          { ...validExtraction.discounts[0], appliesToItemIndex: null },
        ],
      }),
    ).success,
    true,
  );
});

// Test for rejecting invalid dates, times, amounts, units, and source indexes.
test("rejects invalid dates, times, amounts, units, and source indexes", () => {
  const schema = createReceiptExtractionSchema(["food"]);
  const invalidReceipts = [
    withChanges({ purchaseDate: "2026-02-30" }),
    withChanges({ purchaseTime: "24:00" }),
    withChanges({ currency: "12A" }),
    withChanges({ totalCents: 1.5 }),
    withChanges({
      items: [{ ...validExtraction.items[0], packageAmount: 0 }],
    }),
    withChanges({ items: [{ ...validExtraction.items[0], unit: "box" }] }),
    withChanges({
      items: [{ ...validExtraction.items[0], quantity: -1 }],
    }),
    withChanges({
      items: [{ ...validExtraction.items[0], sourceLineIndexes: [-1] }],
    }),
    withChanges({
      discounts: [{ ...validExtraction.discounts[0], amountCents: 0 }],
    }),
    withChanges({
      discounts: [{ ...validExtraction.discounts[0], appliesToItemIndex: -1 }],
    }),
  ];

  for (const receipt of invalidReceipts) {
    assert.equal(schema.safeParse(receipt).success, false);
  }
});
