import {
  hasReviewChanges,
  requiresReviewConfirmation,
} from "../src/review/review-changes.ts";
import {
  initialImportState,
  importReducer,
} from "../src/scans/import-state.ts";
import assert from "node:assert/strict";
import {
  selectedItemId,
  toggleItemSelection,
  selectionAfterRemoval,
} from "../src/review/item-selection.ts";
import test from "node:test";
import {
  addItemWarranty,
  buildFinalSaveDto,
  chooseProduct,
  changeLineType,
  createReviewDraft,
  formatCents,
  isValidDate,
  parseCents,
  reviewIssues,
  reviewSumStatus,
  warrantyDateIssue,
  createEmptyItem,
  removeReviewItem,
} from "../src/review/review-state.ts";
import {
  getReviewLookup,
  isReviewDto,
  ReviewApiError,
} from "../src/api/review-api.ts";

import {
  confirmReceipt,
  getSavedReceipt,
  isSavedReceipt,
  ReceiptApiError,
} from "../src/api/receipt-api.ts";
import {
  duplicateIdentity,
  duplicateReviewDecision,
  confirmDuplicateReview,
} from "../src/review/duplicate-review.ts";

// Sample review object used for testing the review state functions.
const review = {
  scanId: "scan",
  archiveUrl: "/archive",
  merchant: {
    rawName: "TEST MARKET",
    normalizedName: "Test Market",
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
  assert.equal(draft.merchantRawName, "TEST MARKET");
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

// Tests for merchant name confirmation and canonical name replacement.
test("only confirmed merchant matches replace the extracted name with the canonical name", () => {
  const extracted = {
    ...review,
    merchant: {
      rawName: "TST MRKT",
      normalizedName: "TST MRKT",
      match: {
        status: "MATCHED",
        merchantId: 4,
        candidates: [
          { merchantId: 9, name: "Other merchant" },
          { merchantId: 4, name: "Test Market" },
        ],
      },
    },
  };
  const before = structuredClone(extracted);
  const draft = createReviewDraft(extracted);
  assert.equal(draft.merchantName, "Test Market");
  assert.equal(draft.merchantRawName, "TST MRKT");
  assert.equal(draft.merchantId, 4);
  assert.equal(buildFinalSaveDto(draft).merchant.name, "Test Market");
  assert.deepEqual(extracted, before);
  for (const status of ["SUGGESTED", "NEW"]) {
    const unconfirmed = createReviewDraft({
      ...extracted,
      merchant: {
        ...extracted.merchant,
        match: { ...extracted.merchant.match, status, merchantId: null },
      },
    });
    assert.equal(unconfirmed.merchantName, "TST MRKT");
    assert.equal(unconfirmed.merchantId, null);
  }
});

// Tests for review API requiring stored category on product candidates.
test("review API requires the stored category on product candidates", () => {
  const candidate = {
    productId: 8,
    name: "Canonical product",
    brand: null,
    productGroup: "Canonical group",
    category: "food",
    packageAmount: null,
    packageUnit: null,
    score: 1,
  };
  const withCandidate = (value) => ({
    ...review,
    duplicateCandidates: [],
    items: [
      {
        ...review.items[0],
        match: {
          status: "MATCHED",
          productId: 8,
          candidates: [value],
        },
      },
    ],
  });
  assert.equal(isReviewDto(withCandidate(candidate)), true);
  const missingCategory = { ...candidate };
  delete missingCategory.category;
  assert.equal(isReviewDto(withCandidate(missingCategory)), false);
  assert.equal(
    isReviewDto(withCandidate({ ...candidate, category: null })),
    false,
  );
});

// Tests for choosing products for item drafts.
test("matched products show canonical names and categories while clearing restores the new-product draft", () => {
  const extractedItem = {
    ...review.items[0],
    rawName: "Product Alpha RAW",
    normalizedName: "Product Alpha",
    category: "other",
    match: {
      status: "MATCHED",
      productId: 8,
      candidates: [
        {
          productId: 8,
          name: "Stored Product Alpha",
          brand: null,
          productGroup: "fries",
          category: "food",
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
  assert.equal(matched.rawName, "Product Alpha RAW");
  assert.equal(matched.normalizedName, "Product Alpha");
  assert.equal(matched.productId, 8);
  assert.equal(matched.selectedProductName, "Stored Product Alpha");
  assert.equal(matched.matchStatus, "MATCHED");
  assert.equal(matched.selectedProductDetails.categoryName, "food");
  assert.equal(matched.category, "other");

  const manuallySelected = chooseProduct(matched, {
    id: 9,
    name: "Other saved product",
    brandName: "Canonical brand",
    productGroupName: "Canonical group",
    categoryName: "food",
    packageAmount: 500,
    packageUnit: "g",
  });
  assert.equal(manuallySelected.selectedProductName, "Other saved product");
  assert.equal(manuallySelected.matchStatus, null);
  assert.equal(manuallySelected.normalizedName, "Product Alpha");
  assert.deepEqual(manuallySelected.selectedProductDetails, {
    brandName: "Canonical brand",
    productGroupName: "Canonical group",
    categoryName: "food",
    packageAmount: 500,
    packageUnit: "g",
  });
  assert.equal(manuallySelected.productGroup, matched.productGroup);
  const cleared = chooseProduct(manuallySelected, null);
  assert.equal(cleared.productId, null);
  assert.equal(cleared.selectedProductName, null);
  assert.equal(cleared.selectedProductDetails, null);
  assert.equal(cleared.normalizedName, "Product Alpha");
  assert.equal(cleared.brand, matched.brand);
  assert.equal(cleared.category, "other");

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

// Test for verifying that the final save DTO correctly includes confirmed associations, monetary values in cents, and warranties.
test("final save data contains confirmed associations, cents, and warranties", () => {
  const draft = createReviewDraft(review);
  draft.items[0].warranties = [
    {
      id: "warranty",
      type: "manufacturer",
      startDate: "2026-09-29",
      endDate: "2028-09-29",
      notes: "receipt required",
    },
  ];
  const finalSave = buildFinalSaveDto(draft);
  assert.ok(finalSave);
  assert.deepEqual(finalSave.merchant, {
    id: 4,
    name: "Test Market",
    rawName: "TEST MARKET",
  });
  assert.equal(finalSave.totalCents, 119);
  assert.equal(finalSave.items[0].productId, 8);
  assert.equal(finalSave.items[0].unitPriceCents, 149);
  assert.equal(finalSave.items[0].warranties[0].type, "manufacturer");
  assert.deepEqual(finalSave.discounts, [
    { description: "RABATT", amountCents: 30, appliesToItemIndex: 0 },
  ]);
  draft.items[0].warranties[0].endDate = "2025-01-01";
  assert.equal(buildFinalSaveDto(draft), null);
});

// Test for verifying that changing a product line to a non-product type removes warranties and clears the product selection.
test("changing a product line to another type removes warranties and its selection", () => {
  for (const lineType of ["deposit", "fee", "other"]) {
    const draft = createReviewDraft(review);
    const product = draft.items[0];
    product.warranties = [
      {
        id: "warranty",
        type: "manufacturer",
        startDate: "2026-09-29",
        endDate: "2028-09-29",
        notes: "",
      },
    ];
    const changed = changeLineType(product, lineType);
    assert.equal(changed.lineType, lineType);
    assert.equal(changed.productId, null);
    assert.equal(changed.selectedProductName, null);
    assert.equal(changed.selectedProductDetails, null);
    assert.equal(changed.matchStatus, null);
    assert.deepEqual(changed.warranties, []);
    assert.equal(changed.rawName, product.rawName);
    assert.equal(changed.totalPrice, product.totalPrice);
    draft.items[0] = changed;
    assert.deepEqual(reviewIssues(draft), []);
    assert.deepEqual(buildFinalSaveDto(draft).items[0].warranties, []);
    const restored = changeLineType(changed, "product");
    assert.deepEqual(restored.warranties, []);
    assert.equal(restored.productId, null);
    assert.equal(product.warranties.length, 1);
    assert.deepEqual(changeLineType(product, "product"), product);
  }
});

// Test for verifying that the review validation correctly rejects warranties on non-product lines.
test("review validation still rejects warranties on non-product lines", () => {
  for (const lineType of ["deposit", "fee", "other"]) {
    const draft = createReviewDraft(review);
    draft.items[0].lineType = lineType;
    draft.items[0].warranties = [
      {
        id: "warranty",
        type: "manufacturer",
        startDate: "2026-09-29",
        endDate: "2028-09-29",
        notes: "",
      },
    ];
    assert.ok(reviewIssues(draft).some((issue) => issue.code === "warranty"));
    assert.equal(buildFinalSaveDto(draft), null);
  }
});

// Test for verifying that removing an item correctly updates discount references.
test("removing an item detaches its discounts and shifts later references without changing the extraction", () => {
  const draft = createReviewDraft(review);
  draft.items.push(createEmptyItem(), createEmptyItem());
  draft.discounts = [null, 0, 1, 2].map((appliesToItemIndex, index) => ({
    ...draft.discounts[0],
    id: `discount-${index}`,
    appliesToItemIndex,
  }));
  const original = structuredClone(draft);
  const updated = removeReviewItem(draft, draft.items[1].id);
  assert.deepEqual(
    updated.discounts.map((discount) => discount.appliesToItemIndex),
    [null, 0, null, 1],
  );
  assert.equal(updated.items[1].id, draft.items[2].id);
  assert.deepEqual(draft, original);
  assert.equal(removeReviewItem(draft, "missing"), draft);
  const firstRemoved = removeReviewItem(draft, draft.items[0].id);
  assert.deepEqual(
    firstRemoved.discounts.map((discount) => discount.appliesToItemIndex),
    [null, null, 0, 1],
  );
});

// Test for verifying that a fresh extraction of the same scan rebuilds all edit and association state with new item identities.
test("a fresh extraction of the same scan rebuilds all edit and association state with new item identities", () => {
  const previous = createReviewDraft(review);
  previous.merchantName = "edited merchant";
  previous.items[0] = chooseProduct(previous.items[0], {
    id: 99,
    name: "manual choice",
  });
  previous.items[0].sourceLineIndexes.push(99);
  previous.items[0].warranties.push({
    id: "old-warranty",
    type: "manufacturer",
    startDate: "2026-01-01",
    endDate: "2028-01-01",
    notes: "old notes",
  });
  previous.discounts[0].sourceLineIndexes.push(99);
  previous.discounts[0].amount = "99.00";
  const next = createReviewDraft({
    ...review,
    items: [
      { ...review.items[0], normalizedName: "New extraction", match: null },
    ],
    discounts: [],
  });
  assert.equal(next.merchantName, "Test Market");
  assert.equal(next.items[0].normalizedName, "New extraction");
  assert.equal(next.items[0].productId, null);
  assert.equal(next.items[0].selectedProductName, null);
  assert.equal(next.items[0].brandId, null);
  assert.equal(next.items[0].productGroupId, null);
  assert.deepEqual(next.items[0].warranties, []);
  assert.deepEqual(next.discounts, []);
  assert.notEqual(next.items[0].id, previous.items[0].id);
  assert.deepEqual(review.items[0].sourceLineIndexes, [0]);
  assert.deepEqual(review.discounts[0].sourceLineIndexes, [1]);
});

// Test for verifying that review lookups use encoded search terms and retain selectable product metadata.
test("review lookups use encoded search terms and keep selectable product metadata", async (t) => {
  const products = [
    {
      id: 7,
      name: "Milk",
      brandName: "Brand",
      productGroupName: "Milk",
      categoryName: "food",
      packageAmount: 1,
      packageUnit: "l",
    },
  ];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/products?query=Milk%20%26%20Brand");
    assert.equal(init.cache, "no-store");
    return Response.json(products);
  });
  assert.deepEqual(
    await getReviewLookup("products", "  Milk & Brand "),
    products,
  );
});

// Test for verifying that review responses accept incomplete extraction and refunds but reject structures that cannot be edited safely.
test("review responses accept incomplete extraction and refunds but reject structures that cannot be edited safely", () => {
  const valid = { ...review, duplicateCandidates: [] };
  assert.equal(isReviewDto(valid), true);
  assert.equal(
    isReviewDto({
      ...valid,
      totalCents: null,
      purchaseDate: null,
      currency: null,
      items: [],
      discounts: [],
    }),
    true,
  );
  assert.equal(
    isReviewDto({
      ...valid,
      items: [
        {
          ...review.items[0],
          lineType: "deposit",
          totalPriceCents: -25,
          match: null,
        },
      ],
      discounts: [],
    }),
    true,
  );
  for (const change of [
    {
      merchant: {
        ...valid.merchant,
        match: { status: "unknown", candidates: [] },
      },
    },
    { items: [{ ...valid.items[0], sourceLineIndexes: null }] },
    { items: [{ ...valid.items[0], quantity: 0 }] },
    { items: [{ ...valid.items[0], totalPriceCents: "1.49" }] },
    {
      items: [
        {
          ...valid.items[0],
          match: {
            status: "SUGGESTED",
            productId: null,
            candidates: [{ productId: 1 }],
          },
        },
      ],
    },
    { discounts: [{ ...valid.discounts[0], appliesToItemIndex: -1 }] },
    { discounts: [{ ...valid.discounts[0], appliesToItemIndex: 1 }] },
    { discounts: [{ ...valid.discounts[0], amountCents: "invalid" }] },
  ])
    assert.equal(isReviewDto({ ...valid, ...change }), false);
});

// Test for verifying that lookup failures reject malformed entities and sanitize server and transport details.
test("lookup failures reject malformed entities and sanitize server and transport details", async (t) => {
  let response = () => Response.json([]);
  t.mock.method(globalThis, "fetch", async () => response());
  for (const payload of [
    null,
    {},
    [{ id: -1, name: "invalid" }],
    [{ id: 1, name: null }],
    [{ id: 1, name: "Milk", packageAmount: -1 }],
    [{ id: 1, name: "Milk", brandName: {} }],
  ]) {
    response = () => Response.json(payload);
    await assert.rejects(getReviewLookup("products"), {
      code: "unexpected_response",
    });
  }
  response = () => new Response("private backend details", { status: 500 });
  await assert.rejects(getReviewLookup("categories"), {
    code: "categories_failed",
  });
  await assert.rejects(getReviewLookup("merchants"), (error) => {
    assert.ok(error instanceof ReviewApiError);
    assert.equal(error.code, "lookup_failed");
    assert.equal(String(error).includes("private"), false);
    return true;
  });
  response = () => new Response("invalid JSON");
  await assert.rejects(getReviewLookup("products"), {
    code: "unexpected_response",
  });
  response = () => {
    throw new Error("private transport details");
  };
  await assert.rejects(getReviewLookup("products"), { code: "network_error" });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(getReviewLookup("products", "", controller.signal), {
    name: "AbortError",
  });
});

// Sample data for testing duplicate and saved receipts.
const scanId = "5aa1a222-b333-4ccc-8ddd-555566667777";
const duplicate = {
  receiptId: 7,
  merchantId: 4,
  merchantName: "Test Market",
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  totalCents: 119,
  currency: "EUR",
  imagePath: "receipts/archive.webp",
  items: [
    {
      position: 0,
      rawName: "MILCH",
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 149,
      totalPriceCents: 149,
      lineType: "product",
      productId: 8,
    },
  ],
};
const savedReceipt = {
  id: 7,
  merchantId: 4,
  merchantName: "Test Market",
  merchantRawName: "TEST MARKET",
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  totalCents: 119,
  currency: "EUR",
  imageUrl: "/api/receipts/7/image",
  items: [
    {
      id: 11,
      position: 0,
      rawName: "MILCH",
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 149,
      totalPriceCents: 149,
      lineType: "product",
      product: {
        id: 8,
        name: "Milk",
        brandName: null,
        productGroupName: "milk",
        categoryName: "food",
        packageAmount: 1,
        packageUnit: "l",
      },
      warranties: [
        {
          id: 12,
          receiptItemId: 11,
          type: "statutory",
          startDate: "2026-09-29",
          endDate: "2028-09-29",
          notes: null,
        },
      ],
    },
  ],
  discounts: [
    { id: 13, receiptItemId: 11, description: "Coupon", amountCents: 30 },
  ],
};

// Tests for the confirmation process of reviewed receipts, including handling of duplicate overrides and save errors.
test("confirmation sends the reviewed associations, discounts and warranties, and requires an explicit duplicate override", async (t) => {
  const draft = createReviewDraft(review);
  draft.items[0].warranties = [
    {
      id: "draft-warranty",
      type: "statutory",
      startDate: "2026-09-29",
      endDate: "2028-09-29",
      notes: "receipt required",
    },
  ];
  const payload = buildFinalSaveDto(draft);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, `/api/scans/${scanId}/confirm`);
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers["Content-Type"], "application/json");
    const body = JSON.parse(init.body);
    assert.deepEqual(body, { ...payload, duplicateOverride: calls === 1 });
    calls++;
    return calls === 1
      ? Response.json(
          { error: "duplicate_confirmation_required", candidates: [duplicate] },
          { status: 409 },
        )
      : Response.json({ receiptId: 7 }, { status: 201 });
  });
  assert.deepEqual(await confirmReceipt(scanId, payload), {
    kind: "duplicates",
    candidates: [duplicate],
  });
  assert.deepEqual(await confirmReceipt(scanId, payload, true), {
    kind: "saved",
    receiptId: 7,
  });
  assert.equal(calls, 2);
  assert.equal(
    isReviewDto({ ...review, duplicateCandidates: [duplicate] }),
    true,
  );
  assert.equal(
    isReviewDto({
      ...review,
      duplicateCandidates: [{ ...duplicate, items: null }],
    }),
    false,
  );
});

// Tests for the duplicate review logic, including explicit decisions, stale candidate invalidation, and final save conflicts.
test("duplicate review requires an explicit decision, invalidates stale candidates and handles final save conflicts", async (t) => {
  const draft = createReviewDraft(review);
  const checked = {
    identity: duplicateIdentity(draft),
    candidates: [duplicate],
  };
  assert.deepEqual(duplicateReviewDecision(draft, checked), {
    action: "review",
    candidates: [duplicate],
  });
  assert.equal(
    duplicateReviewDecision(draft, confirmDuplicateReview(draft, checked))
      .action,
    "override",
  );
  // Closing a comparison without confirming leaves saving blocked.
  assert.equal(duplicateReviewDecision(draft, checked).action, "review");
  assert.equal(
    duplicateReviewDecision(
      draft,
      confirmDuplicateReview(draft, { ...checked, candidates: [] }),
    ).action,
    "save",
  );
  const approved = confirmDuplicateReview(draft, checked);
  assert.equal(approved.confirmed, true);
  assert.equal(checked.confirmed, undefined);
  assert.equal(duplicateReviewDecision(draft, approved).action, "override");
  assert.equal(duplicateReviewDecision(draft, approved).action, "override");
  const original = structuredClone(draft);
  for (const changes of [
    { merchantId: 9 },
    { purchaseDate: "2026-09-30" },
    { purchaseTime: "15:00" },
    { total: "2.49" },
  ]) {
    const edited = { ...draft, ...changes };
    assert.deepEqual(
      duplicateReviewDecision(edited, confirmDuplicateReview(draft, checked)),
      {
        action: "save",
        candidates: [],
      },
    );
  }
  const itemEdited = structuredClone(draft);
  itemEdited.items[0].quantity = "2";
  itemEdited.items[0].normalizedName = "Corrected product";
  itemEdited.items[0].warranties = [
    {
      id: "warranty",
      type: "statutory",
      startDate: "2026-09-29",
      endDate: "2028-09-29",
      notes: "",
    },
  ];
  assert.equal(duplicateReviewDecision(itemEdited, checked).action, "review");
  assert.equal(
    duplicateIdentity({ ...draft, total: "1,19" }),
    duplicateIdentity(draft),
  );

  // After identity edits a normal save must still reach the backend without override.
  const edited = { ...draft, total: "2.49" };
  const finalCandidate = { ...duplicate, totalCents: 249 };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.duplicateOverride, false);
    assert.equal(payload.totalCents, 249);
    return Response.json(
      {
        error: "duplicate_confirmation_required",
        candidates: [finalCandidate],
      },
      { status: 409 },
    );
  });
  const result = await confirmReceipt(scanId, buildFinalSaveDto(edited));
  assert.equal(result.kind, "duplicates");
  const finalCheck = {
    identity: duplicateIdentity(edited),
    candidates: result.candidates,
  };
  assert.equal(duplicateReviewDecision(edited, finalCheck).action, "review");
  assert.equal(
    duplicateReviewDecision(edited, confirmDuplicateReview(edited, finalCheck))
      .action,
    "override",
  );
  assert.equal(duplicateReviewDecision(edited, finalCheck).action, "review");
  // Only the later normal Save request imports the receipt using the confirmed comparison.
  const approvedFinalCheck = confirmDuplicateReview(edited, finalCheck);
  let saves = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    saves += 1;
    assert.equal(JSON.parse(init.body).duplicateOverride, true);
    return Response.json({ receiptId: 7 }, { status: 201 });
  });
  assert.equal(saves, 0);
  const saved = await confirmReceipt(
    scanId,
    buildFinalSaveDto(edited),
    duplicateReviewDecision(edited, approvedFinalCheck).action === "override",
  );
  assert.equal(saved.kind, "saved");
  assert.equal(saves, 1);
  assert.equal(duplicateReviewDecision(edited, finalCheck).action, "review");
  assert.equal(confirmDuplicateReview(edited, checked).confirmed, false);
  assert.deepEqual(draft, original);
});

// Tests for merchant name and alias edits affecting duplicate approval.
test("merchant name and alias edits invalidate duplicate approval before an ID is selected", () => {
  const draft = { ...createReviewDraft(review), merchantId: null };
  const approved = confirmDuplicateReview(draft, {
    identity: duplicateIdentity(draft),
    candidates: [duplicate],
  });
  assert.equal(duplicateReviewDecision(draft, approved).action, "override");
  for (const changes of [
    { merchantName: "Demo Store" },
    { merchantRawName: "T+ST MARKET" },
    { merchantId: 9 },
  ]) {
    assert.deepEqual(
      duplicateReviewDecision({ ...draft, ...changes }, approved),
      {
        action: "save",
        candidates: [],
      },
    );
  }
  const selected = { ...draft, merchantId: 9 };
  assert.equal(
    duplicateIdentity(selected),
    duplicateIdentity({
      ...selected,
      merchantName: "Demo Store",
      merchantRawName: "T+ST MARKET",
    }),
  );
});

// Tests for classification of save errors and handling of broken duplicate payloads.
test("confirmation returns merchant selection conflicts and rejects malformed candidates", async (t) => {
  const candidates = [
    { merchantId: 1, name: "Test Market" },
    { merchantId: 2, name: "Demo Store" },
  ];
  let value = { error: "merchant_selection_required", candidates };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(value, { status: 409 }),
  );
  const payload = buildFinalSaveDto(createReviewDraft(review));
  assert.deepEqual(await confirmReceipt(scanId, payload), {
    kind: "merchant_selection_required",
    candidates,
  });
  for (const invalid of [
    [],
    null,
    [{ merchantId: -1, name: "Test Market" }],
    [{ merchantId: 1, name: "" }],
    [{ merchantId: 1 }],
    [null],
  ]) {
    value = { error: "merchant_selection_required", candidates: invalid };
    await assert.rejects(confirmReceipt(scanId, payload), {
      code: "unexpected_response",
    });
  }
});

test("confirmation classifies save errors and rejects broken duplicate payloads without leaking server details", async (t) => {
  let response = () => Response.json({ receiptId: 7 }, { status: 201 });
  t.mock.method(globalThis, "fetch", async () => response());
  const payload = buildFinalSaveDto(createReviewDraft(review));
  for (const code of [
    "invalid_final_save",
    "scan_archive_not_found",
    "confirmed_entity_not_found",
    "receipt_save_failed",
  ]) {
    response = () =>
      Response.json(
        { error: code, message: "private details" },
        { status: 400 },
      );
    await assert.rejects(
      confirmReceipt(scanId, payload),
      (error) =>
        error instanceof ReceiptApiError &&
        error.code === code &&
        !String(error).includes("private"),
    );
  }
  for (const candidates of [[], null, [{ ...duplicate, items: [{}] }]]) {
    response = () =>
      Response.json(
        { error: "duplicate_confirmation_required", candidates },
        { status: 409 },
      );
    await assert.rejects(confirmReceipt(scanId, payload), {
      code: "unexpected_response",
    });
  }
  for (const value of [
    { receiptId: -1 },
    { receiptId: "7" },
    null,
    { error: "private error" },
  ]) {
    response = () => Response.json(value);
    await assert.rejects(confirmReceipt(scanId, payload), {
      code: "unexpected_response",
    });
  }
  response = () => new Response("private server details", { status: 500 });
  await assert.rejects(confirmReceipt(scanId, payload), {
    code: "unexpected_response",
  });
  response = () => {
    throw new Error("private transport details");
  };
  await assert.rejects(confirmReceipt(scanId, payload), {
    code: "network_error",
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    confirmReceipt(scanId, payload, false, controller.signal),
    { name: "AbortError" },
  );
});

// Tests for fetching saved receipts, including handling of associations, foreign images, broken references, and malformed nested data.
test("saved receipts reload with associations and reject foreign images, broken references and malformed nested data", async (t) => {
  let response = () => Response.json(savedReceipt);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/receipts/7");
    assert.equal(init.cache, "no-store");
    return response();
  });
  assert.deepEqual(await getSavedReceipt(7), savedReceipt);
  assert.equal(isSavedReceipt(savedReceipt), true);
  for (const change of [
    { imageUrl: "https://foreign.test/image" },
    { purchaseDate: "2026-02-30" },
    { purchaseTime: "24:00" },
    { discounts: [{ ...savedReceipt.discounts[0], receiptItemId: 99 }] },
    {
      items: [
        {
          ...savedReceipt.items[0],
          product: { ...savedReceipt.items[0].product, name: null },
        },
      ],
    },
    {
      items: [
        {
          ...savedReceipt.items[0],
          warranties: [
            { ...savedReceipt.items[0].warranties[0], receiptItemId: 99 },
          ],
        },
      ],
    },
    {
      items: [
        {
          ...savedReceipt.items[0],
          warranties: [
            { ...savedReceipt.items[0].warranties[0], endDate: "2025-01-01" },
          ],
        },
      ],
    },
    { items: [{ ...savedReceipt.items[0], quantity: 0 }] },
  ]) {
    const value = { ...savedReceipt, ...change };
    assert.equal(isSavedReceipt(value), false);
  }
  // One malformed DTO verifies that the API actually applies the validator above.
  response = () =>
    Response.json({ ...savedReceipt, imageUrl: "https://foreign.test/image" });
  await assert.rejects(getSavedReceipt(7), { code: "unexpected_response" });
  response = () =>
    Response.json({
      ...savedReceipt,
      id: 8,
      imageUrl: "/api/receipts/8/image",
    });
  await assert.rejects(getSavedReceipt(7), { code: "unexpected_response" });
  response = () => new Response("private details", { status: 404 });
  await assert.rejects(getSavedReceipt(7), { code: "receipt_not_found" });
  response = () => new Response("private details", { status: 500 });
  await assert.rejects(getSavedReceipt(7), { code: "receipt_detail_failed" });
  response = () => {
    throw new Error("private details");
  };
  await assert.rejects(getSavedReceipt(7), { code: "network_error" });
});

// Tests for item selection behavior in the review draft.
test("item selection follows draft IDs through edits, addition, removal and empty lists", () => {
  const draft = createReviewDraft(review);
  const first = draft.items[0];
  const second = {
    ...first,
    id: "second",
    normalizedName: "Edited product",
    warranties: [],
  };
  const third = { ...first, id: "third", warranties: [] };
  draft.items.push(second, third);
  assert.equal(selectedItemId(draft.items, null), null);
  assert.equal(selectedItemId(draft.items.toReversed(), second.id), second.id);
  assert.equal(selectedItemId(draft.items, "missing"), null);
  let selection = toggleItemSelection(null, second.id);
  assert.equal(selectedItemId(draft.items, selection), second.id);
  selection = toggleItemSelection(selection, second.id);
  assert.equal(selectedItemId(draft.items, selection), null);
  assert.equal(selectionAfterRemoval(draft.items, selection, first.id), null);
  selection = toggleItemSelection(selection, third.id);
  assert.equal(selectedItemId(draft.items, selection), third.id);
  assert.equal(toggleItemSelection(selection, second.id), second.id);
  const added = createEmptyItem();
  draft.items.push(added);
  assert.equal(selectedItemId(draft.items, added.id), added.id);
  assert.equal(
    selectionAfterRemoval(draft.items, second.id, second.id),
    third.id,
  );
  assert.equal(
    selectionAfterRemoval(draft.items, added.id, added.id),
    third.id,
  );
  assert.equal(
    selectionAfterRemoval(draft.items, second.id, first.id),
    second.id,
  );
  const before = structuredClone(draft);
  selectedItemId(draft.items, first.id);
  selectedItemId(draft.items, second.id);
  assert.deepEqual(draft, before);
  assert.equal(selectionAfterRemoval([first], first.id, first.id), null);
  assert.equal(selectedItemId([], added.id), null);
});

// Tests for warranty handling in the review draft.
test("incomplete warranty inputs stay in the item draft across selection and block final save until corrected", () => {
  const draft = createReviewDraft(review);
  const target = draft.items[0];
  const original = structuredClone(target);
  const warranty = {
    id: "warranty-draft",
    type: "statutory",
    startDate: draft.purchaseDate,
    endDate: "",
    notes: "Keep these notes",
  };
  draft.items[0] = addItemWarranty(draft.items[0], warranty);
  const firstId = draft.items[0].id;
  draft.items.push({ ...original, id: "another-item" });
  const deselected = toggleItemSelection(firstId, firstId);
  assert.equal(selectedItemId(draft.items, deselected), null);
  selectedItemId(draft.items, "another-item");
  selectedItemId(draft.items, firstId);
  assert.equal(draft.items[0].warranties[0].notes, "Keep these notes");
  assert.ok(reviewIssues(draft).some((issue) => issue.code === "warranty"));
  assert.equal(buildFinalSaveDto(draft), null);
  draft.items[0].warranties[0] = {
    ...warranty,
    type: "manufacturer",
    endDate: "2028-09-29",
  };
  const payload = buildFinalSaveDto(draft);
  assert.ok(payload);
  assert.equal(payload.items[0].warranties[0].notes, "Keep these notes");
  assert.equal(payload.items[0].warranties[0].type, "manufacturer");
  assert.deepEqual(target, original);
  const fee = changeLineType(original, "fee");
  assert.equal(addItemWarranty(fee, warranty), fee);
});

// Tests for detecting changes in the review draft.
test("review change detection includes header, assignment, discounts and unfinished warranties", () => {
  const original = createReviewDraft(review);
  assert.equal(hasReviewChanges(original, original), false);
  assert.equal(hasReviewChanges(original, structuredClone(original)), false);
  const edits = [
    { ...original, merchantName: "Edited merchant" },
    {
      ...original,
      items: original.items.map((item) => ({ ...item, productId: null })),
    },
    {
      ...original,
      discounts: original.discounts.map((discount) => ({
        ...discount,
        amount: "0.40",
      })),
    },
    {
      ...original,
      items: original.items.map((item) =>
        addItemWarranty(item, {
          id: "pending",
          type: "statutory",
          startDate: original.purchaseDate,
          endDate: "",
          notes: "In progress",
        }),
      ),
    },
  ];
  for (const draft of edits)
    assert.equal(hasReviewChanges(original, draft), true);
  const restored = { ...edits[0], merchantName: original.merchantName };
  assert.equal(hasReviewChanges(original, restored), false);
});

// Tests for scan changes and reprocessing requiring approval.
test("scan changes and reprocessing need approval only when replacing an edited review", () => {
  const state = {
    ...initialImportState,
    scan: {
      scanId: "scan",
      suggestedCorners: {
        topLeft: [0, 0],
        topRight: [1, 0],
        bottomRight: [1, 1],
        bottomLeft: [0, 1],
      },
      rotation: 0,
    },
    corners: {
      topLeft: [0, 0],
      topRight: [1, 0],
      bottomRight: [1, 1],
      bottomLeft: [0, 1],
    },
    processed: { review },
  };
  for (const action of [
    { type: "corners", corners: state.corners },
    { type: "rotate", turn: 90 },
    { type: "receipt-frame" },
    { type: "start", operation: "process" },
  ]) {
    assert.equal(requiresReviewConfirmation(state, true, action), true);
    assert.equal(requiresReviewConfirmation(state, false, action), false);
    assert.equal(
      requiresReviewConfirmation({ ...state, processed: null }, true, action),
      false,
    );
    assert.equal(importReducer(state, action).processed, null);
    assert.deepEqual(state.processed.review, review);
  }
  for (const action of [
    { type: "settled" },
    { type: "start", operation: "upload" },
    { type: "processed", result: state.processed },
  ])
    assert.equal(requiresReviewConfirmation(state, true, action), false);
});
