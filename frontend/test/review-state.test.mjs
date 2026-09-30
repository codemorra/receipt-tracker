import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseProduct,
  createReviewDraft,
  formatCents,
  isValidDate,
  parseCents,
  reviewIssues,
  reviewSumStatus,
  warrantyDateIssue,
} from "../src/review/review-state.ts";

// Sample review object used for testing the review state functions.
const review = {
  scanId: "scan",
  archiveUrl: "/archive",
  merchant: {
    rawName: "EDEKA",
    normalizedName: "Edeka",
    match: { status: "MATCHED", merchantId: 4, candidates: [] },
  },
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  currency: "EUR",
  totalCents: 119,
  items: [
    {
      rawName: "MILCH",
      normalizedName: "Milk",
      brand: null,
      productGroup: "milk",
      category: "food",
      packageAmount: 1,
      packageUnit: "l",
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 149,
      totalPriceCents: 149,
      lineType: "product",
      sourceLineIndexes: [0],
      match: { status: "MATCHED", productId: 8, candidates: [] },
    },
  ],
  discounts: [
    {
      rawName: "RABATT",
      description: null,
      amountCents: 30,
      appliesToItemIndex: 0,
      sourceLineIndexes: [1],
    },
  ],
  warnings: [],
};

// Tests for the review state functions.
test("review draft keeps extracted values and confirmed match IDs", () => {
  const draft = createReviewDraft(review);
  assert.equal(draft.merchantId, 4);
  assert.equal(draft.merchantRawName, "EDEKA");
  assert.equal(draft.total, "1.19");
  assert.equal(draft.items[0].productId, 8);
  assert.equal(draft.items[0].unitPrice, "1.49");
  assert.equal(draft.discounts[0].amount, "0.30");
  assert.equal(draft.discounts[0].appliesToItemIndex, 0);
  assert.deepEqual(draft.items[0].sourceLineIndexes, [0]);
  const missingProductName = createReviewDraft({
    ...review,
    items: [{ ...review.items[0], normalizedName: null }],
  });
  assert.equal(missingProductName.items[0].normalizedName, "MILCH");
});

// Tests for money conversion functions.
test("money conversion accepts decimal comma and rejects fractional cents", () => {
  assert.equal(formatCents(-55), "-0.55");
  assert.equal(parseCents("1,19"), 119);
  assert.equal(parseCents("-0.50"), -50);
  assert.equal(parseCents("1.234"), null);
  assert.equal(parseCents("abc"), null);
  assert.equal(parseCents(""), null);
});

// Tests for review sum status function.
test("review sum updates after price edits and allows one cent rounding", () => {
  const draft = createReviewDraft(review);
  assert.equal(reviewSumStatus(draft), "MATCH");
  draft.items[0].totalPrice = "1.50";
  assert.equal(reviewSumStatus(draft), "MATCH");
  draft.items[0].totalPrice = "1.52";
  assert.equal(reviewSumStatus(draft), "MISMATCH");
  draft.items[0].totalPrice = "";
  assert.equal(reviewSumStatus(draft), "INCOMPLETE");
  draft.items = [];
  draft.total = "0.00";
  assert.equal(reviewSumStatus(draft), "INCOMPLETE");
});

// Tests for warranty date validation function.
test("warranty dates must exist, be valid, and be ordered", () => {
  const warranty = {
    id: "warranty",
    type: "statutory",
    startDate: "2026-09-29",
    endDate: "",
    notes: "",
  };
  assert.equal(warrantyDateIssue(warranty), "missing");
  warranty.endDate = "2026-02-30";
  assert.equal(isValidDate(warranty.endDate), false);
  assert.equal(warrantyDateIssue(warranty), "invalid");
  warranty.endDate = "2026-09-28";
  assert.equal(warrantyDateIssue(warranty), "range");
  warranty.endDate = "2026-09-29";
  assert.equal(warrantyDateIssue(warranty), null);
});

// Tests for review issues function.
test("review issues flag invalid receipt values and discount amounts", () => {
  const draft = createReviewDraft(review);
  assert.deepEqual(reviewIssues(draft), []);
  draft.purchaseDate = "2026-02-30";
  draft.currency = "EU";
  draft.items[0].quantity = "0";
  draft.discounts[0].amount = "-0.30";
  assert.deepEqual(
    reviewIssues(draft).map((issue) => issue.code),
    ["purchaseDate", "currency", "quantity", "discountAmount"],
  );
});

// Tests for choosing products for item drafts.
test("matched products show canonical names while clearing restores the new-product draft", () => {
  const extractedItem = {
    ...review.items[0],
    rawName: "Wellenschnitt Pommes",
    normalizedName: "Pommes",
    match: {
      status: "MATCHED",
      productId: 8,
      candidates: [
        {
          productId: 8,
          name: "Gubuhubu!",
          brand: null,
          productGroup: "fries",
          packageAmount: null,
          packageUnit: null,
          score: 1,
        },
      ],
    },
  };
  const matched = createReviewDraft({
    ...review,
    items: [extractedItem],
  }).items[0];
  assert.equal(matched.rawName, "Wellenschnitt Pommes");
  assert.equal(matched.normalizedName, "Pommes");
  assert.equal(matched.productId, 8);
  assert.equal(matched.selectedProductName, "Gubuhubu!");
  assert.equal(matched.matchStatus, "MATCHED");

  const manuallySelected = chooseProduct(matched, {
    id: 9,
    name: "Other saved product",
  });
  assert.equal(manuallySelected.selectedProductName, "Other saved product");
  assert.equal(manuallySelected.matchStatus, null);
  assert.equal(manuallySelected.normalizedName, "Pommes");
  const cleared = chooseProduct(manuallySelected, null);
  assert.equal(cleared.productId, null);
  assert.equal(cleared.selectedProductName, null);
  assert.equal(cleared.normalizedName, "Pommes");
  assert.equal(cleared.brand, matched.brand);

  const suggested = createReviewDraft({
    ...review,
    items: [
      {
        ...extractedItem,
        match: { ...extractedItem.match, status: "SUGGESTED", productId: null },
      },
    ],
  }).items[0];
  assert.equal(suggested.productId, null);
  assert.equal(suggested.selectedProductName, null);
  assert.equal(suggested.matchStatus, "SUGGESTED");
});
