import assert from "node:assert/strict";
import test from "node:test";
import {
  savedReceiptToSummary,
  reviewDraftToSummary,
} from "../src/receipts/receipt-summary.ts";
import {
  createEmptyItem,
  chooseProduct,
  removeReviewItem,
} from "../src/review/review-state.ts";

const product = {
  id: 7,
  name: "Canonical milk",
  brandName: null,
  productGroupName: "milk",
  categoryName: "food",
  packageAmount: 1,
  packageUnit: "l",
};
const warranty = {
  type: "statutory",
  startDate: "2026-09-30",
  endDate: "2028-09-30",
  notes: "Keep packaging",
};
const saved = {
  id: 1,
  merchantId: 4,
  merchantName: "Edeka",
  merchantRawName: "EDEKA CITY",
  purchaseDate: "2026-09-30",
  purchaseTime: "12:30",
  totalCents: 180,
  currency: "EUR",
  imageUrl: "/api/receipts/1/image",
  items: [
    {
      id: 11,
      position: 0,
      rawName: "MILCH",
      quantity: 1.5,
      unit: "pcs",
      unitPriceCents: 149,
      totalPriceCents: 200,
      lineType: "product",
      product,
      warranties: [{ id: 21, receiptItemId: 11, ...warranty }],
    },
    {
      id: 12,
      position: 1,
      rawName: "Fee",
      quantity: 1,
      unit: null,
      unitPriceCents: null,
      totalPriceCents: 0,
      lineType: "fee",
      product: null,
      warranties: [],
    },
  ],
  discounts: [
    { id: 31, receiptItemId: 11, description: "Promotion", amountCents: 10 },
    { id: 32, receiptItemId: null, description: "Coupon", amountCents: 10 },
  ],
};
function draft() {
  return {
    merchantName: "Edeka",
    merchantRawName: "EDEKA CITY",
    merchantId: 4,
    merchantMatchStatus: "MATCHED",
    merchantCandidates: [],
    purchaseDate: "2026-09-30",
    purchaseTime: "12:30",
    currency: "EUR",
    total: "1,80",
    items: [
      {
        ...chooseProduct(createEmptyItem(), product),
        id: "11",
        rawName: "MILCH",
        normalizedName: "Extracted milk",
        brand: "Extracted brand",
        productGroup: "Extracted group",
        category: "other",
        packageAmount: "500",
        packageUnit: "g",
        quantity: "1,5",
        unit: "pcs",
        unitPrice: "1.49",
        totalPrice: "2.00",
        warranties: [{ id: "21", ...warranty }],
      },
      {
        ...createEmptyItem(),
        id: "12",
        rawName: "Fee",
        normalizedName: "Ignored product name",
        lineType: "fee",
        quantity: "1",
        totalPrice: "0.00",
      },
    ],
    discounts: [
      {
        id: "31",
        description: "Promotion",
        rawName: "PROMO",
        amount: "0.10",
        appliesToItemIndex: 0,
        sourceLineIndexes: [],
      },
      {
        id: "32",
        description: "",
        rawName: "Coupon",
        amount: "0.10",
        appliesToItemIndex: null,
        sourceLineIndexes: [],
      },
    ],
  };
}

// Tests for the receipt summary conversion functions.
test("saved receipt and import draft produce the same read-only data and discount associations", () => {
  const current = draft();
  const savedBefore = structuredClone(saved);
  const draftBefore = structuredClone(current);
  const fromSaved = savedReceiptToSummary(saved);
  assert.deepEqual(reviewDraftToSummary(current), fromSaved);
  assert.equal(fromSaved.items[0].name, "Canonical milk");
  assert.equal(fromSaved.items[0].rawName, "MILCH");
  assert.equal(fromSaved.items[0].quantity, 1.5);
  assert.deepEqual(fromSaved.items[0].warranties, [{ key: "21", ...warranty }]);
  assert.equal(fromSaved.discounts[0].itemKey, fromSaved.items[0].key);
  assert.equal(fromSaved.discounts[1].itemKey, null);
  assert.equal(fromSaved.items[1].product, null);
  assert.deepEqual(saved, savedBefore);
  assert.deepEqual(current, draftBefore);
  fromSaved.items[0].product.name = "View only";
  fromSaved.items[0].warranties[0].notes = "View only";
  assert.deepEqual(saved, savedBefore);
});

// Tests for the behavior of the summary when the draft is modified.
test("summary follows current product selections, edits and item removal without changing the draft", () => {
  let current = draft();
  current.items[0] = chooseProduct(current.items[0], null);
  current.items[0].totalPrice = "-0,50";
  let summary = reviewDraftToSummary(current);
  assert.equal(summary.items[0].name, "Extracted milk");
  assert.deepEqual(summary.items[0].product, {
    name: "Extracted milk",
    brandName: "Extracted brand",
    productGroupName: "Extracted group",
    categoryName: "other",
    packageAmount: 500,
    packageUnit: "g",
  });
  assert.equal(summary.items[0].totalPriceCents, -50);
  current.items[0] = chooseProduct(current.items[0], {
    id: 8,
    name: "New selection",
  });
  summary = reviewDraftToSummary(current);
  assert.equal(summary.items[0].name, "New selection");
  assert.equal(summary.items[0].product.brandName, null);
  assert.equal(summary.items[0].product.packageAmount, null);
  current = removeReviewItem(current, "11");
  summary = reviewDraftToSummary(current);
  assert.deepEqual(
    summary.items.map((item) => item.key),
    ["12"],
  );
  assert.deepEqual(summary.items[0].warranties, []);
  assert.equal(summary.discounts[0].itemKey, null);
});

// Tests for the behavior of the summary when the draft contains incomplete or invalid values.
test("incomplete or invalid draft values remain unknown rather than becoming valid-looking summary values", () => {
  for (const value of ["", "abc", "1.234", "Infinity"]) {
    const current = draft();
    current.total = value;
    current.items[0].unitPrice = value;
    current.items[0].totalPrice = value;
    current.discounts[0].amount = value;
    const summary = reviewDraftToSummary(current);
    assert.equal(summary.totalCents, null, value);
    assert.equal(summary.items[0].unitPriceCents, null, value);
    assert.equal(summary.items[0].totalPriceCents, null, value);
    assert.equal(summary.discounts[0].amountCents, null, value);
  }
  for (const value of ["", "0", "-1", "1e3", "Infinity", "abc"]) {
    const current = draft();
    current.items[0].quantity = value;
    assert.equal(reviewDraftToSummary(current).items[0].quantity, null, value);
  }
  const current = draft();
  current.merchantName = "  ";
  current.merchantRawName = "";
  current.purchaseDate = "2026-02-30";
  current.purchaseTime = "25:00";
  current.currency = "EU";
  current.items[0].warranties[0].startDate = "invalid";
  current.items[0].warranties[0].endDate = "";
  const summary = reviewDraftToSummary(current);
  for (const key of [
    "merchantName",
    "merchantRawName",
    "purchaseDate",
    "purchaseTime",
    "currency",
  ]) {
    assert.equal(summary[key], null, key);
  }
  assert.equal(summary.items[0].warranties[0].startDate, null);
  assert.equal(summary.items[0].warranties[0].endDate, null);
});
