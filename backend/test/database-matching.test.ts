import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDatabase } from "../src/db/database.js";
import type { ReceiptExtraction } from "../src/extraction/receipt-extraction.js";
import { matchMerchant } from "../src/matching/merchant-matcher.js";
import { matchProduct } from "../src/matching/product-matcher.js";
import { createReviewDto } from "../src/review/review-dto.js";

// Current timestamp used for created_at and updated_at fields in test fixtures.
const now = "2026-09-29T00:00:00.000Z";

// Test fixture representing a single item extracted from a receipt, used for product matching tests.
const item: ReceiptExtraction["items"][number] = {
  rawName: "MILCH 1L",
  normalizedName: "Milch",
  brand: "Test & Brand",
  productGroup: "milk",
  category: "food",
  packageAmount: 1,
  packageUnit: "l",
  quantity: 1,
  unit: "pcs",
  unitPriceCents: 119,
  totalPriceCents: 119,
  lineType: "product",
  sourceLineIndexes: [0],
};

/**
 * Creates a new test fixture with an isolated database and utility functions for adding merchants and products.
 * @returns An object containing the database instance, a cleanup function, and utility functions for adding merchants and products.
 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "receipt-matching-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));
  const cleanup = () => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  };
  const addMerchant = (name: string, alias?: string) => {
    const id = Number(
      sqlite
        .prepare(
          "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
        )
        .run(name, now, now).lastInsertRowid,
    );
    if (alias)
      sqlite
        .prepare(
          "INSERT INTO merchant_alias (merchant_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, alias, alias, now);
    return id;
  };

  /**
   * Adds a new product to the test database, including its group, brand, and optional alias.
   * @param name The name of the product.
   * @param brand The brand of the product, or null if no brand.
   * @param packageAmount The amount of the product's package.
   * @param packageUnit The unit of the product's package.
   * @param alias An optional alias for the product.
   * @returns The ID of the newly created product.
   */
  const addProduct = (
    name: string,
    brand: string | null,
    packageAmount: number,
    packageUnit: string,
    alias?: string,
  ) => {
    const groupId = Number(
      sqlite
        .prepare(
          "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES (1, ?, ?, ?)",
        )
        .run("milk", now, now).lastInsertRowid,
    );
    const brandId =
      brand === null
        ? null
        : Number(
            sqlite
              .prepare(
                "INSERT INTO brand (name, created_at, updated_at) VALUES (?, ?, ?)",
              )
              .run(brand, now, now).lastInsertRowid,
          );
    const id = Number(
      sqlite
        .prepare(
          "INSERT INTO product (product_group_id, brand_id, name, package_amount, package_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(groupId, brandId, name, packageAmount, packageUnit, now, now)
        .lastInsertRowid,
    );
    if (alias)
      sqlite
        .prepare(
          "INSERT INTO product_alias (product_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(id, alias, alias, now);
    return id;
  };
  return { db, cleanup, addMerchant, addProduct };
}

// Tests for database-backed merchant and product matching functions.
test("merchant aliases match only one distinct merchant", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const first = data.addMerchant("Test Market", "test market");
  assert.deepEqual(matchMerchant(data.db, "TEST MARKET"), {
    status: "MATCHED",
    merchantId: first,
    candidates: [{ merchantId: first, name: "Test Market" }],
  });
  data.addMerchant("Test Market Franchise", "test market");
  assert.equal(matchMerchant(data.db, "TEST MARKET").status, "SUGGESTED");
  assert.equal(matchMerchant(data.db, "TEST MARKET").merchantId, null);
  assert.equal(matchMerchant(data.db, "Unknown").status, "NEW");
  assert.equal(matchMerchant(data.db, null).status, "NEW");
});

// Tests for product matching based on aliases, brands, and package information.
test("merchant canonical names are suggestions without a confirmed alias", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  data.addMerchant("Testmühle");
  assert.equal(matchMerchant(data.db, "TESTMUEHLE").status, "SUGGESTED");
});

// Tests for review behavior when correcting OCR-detected merchant names.
test("review suggests the corrected canonical merchant for an unknown OCR alias", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const merchantId = data.addMerchant("Test Market", "test market");
  const review = createReviewDto(
    data.db,
    { scanId: "test-scan", archiveUrl: "/test-archive" },
    {
      merchant: { rawName: "T+ST MARKET", normalizedName: "Test Market" },
      purchaseDate: null,
      purchaseTime: null,
      currency: null,
      totalCents: null,
      items: [],
      discounts: [],
    },
  );
  assert.deepEqual(review.merchant.match, {
    status: "SUGGESTED",
    merchantId: null,
    candidates: [{ merchantId, name: "Test Market" }],
  });
  assert.equal(
    matchMerchant(data.db, "TEST MARKET", "Test Market").status,
    "MATCHED",
  );
  assert.equal(matchMerchant(data.db, null, "Test Market").status, "MATCHED");
  assert.equal(
    matchMerchant(data.db, "T+ST MARKET", "Test Markets").status,
    "NEW",
  );
});

// Tests for review behavior when there is ambiguous or conflicting merchant evidence.
test("review never confirms ambiguous or conflicting merchant evidence", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const first = data.addMerchant("Test Market", "t st market");
  const second = data.addMerchant("Demo Store");
  assert.deepEqual(matchMerchant(data.db, "T+ST MARKET", "Demo Store"), {
    status: "SUGGESTED",
    merchantId: null,
    candidates: [
      { merchantId: first, name: "Test Market" },
      { merchantId: second, name: "Demo Store" },
    ],
  });
  data.addMerchant("TEST-MARKET");
  assert.equal(
    matchMerchant(data.db, "T+ST MARKET", "Test Market").merchantId,
    null,
  );
  data.addMerchant("Shared Market", "t st market");
  assert.equal(
    matchMerchant(data.db, "T+ST MARKET", "Demo Store").merchantId,
    null,
  );
});

// Tests for product alias matching, including handling of conflicting brands and package information.
test("product aliases match once and reject conflicting brand or package", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const id = data.addProduct(
    "Milch",
    "Test und Brand",
    1000,
    "ml",
    "milch 1 l",
  );
  assert.equal(matchProduct(data.db, item).status, "MATCHED");
  assert.equal(matchProduct(data.db, item).productId, id);
  const correctedMatch = matchProduct(data.db, {
    ...item,
    productGroup: "Incorrect extracted group",
    category: "other",
  });
  assert.equal(correctedMatch.status, "MATCHED");
  assert.equal(correctedMatch.candidates[0].productGroup, "milk");
  assert.equal(correctedMatch.candidates[0].category, "food");
  assert.equal(
    matchProduct(data.db, { ...item, brand: "Other" }).status,
    "NEW",
  );
  assert.equal(
    matchProduct(data.db, { ...item, packageAmount: 2 }).status,
    "NEW",
  );
  assert.equal(
    matchProduct(data.db, { ...item, lineType: "deposit" }).status,
    "NEW",
  );
});

// Tests for product package comparison, ensuring correct conversion between units.
test("product package comparison converts kilograms to grams", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const id = data.addProduct("Milch", "Test und Brand", 1000, "g");
  const kilogramItem = {
    ...item,
    packageAmount: 1,
    packageUnit: "kg" as const,
  };
  assert.equal(matchProduct(data.db, kilogramItem).candidates[0].productId, id);
  assert.equal(matchProduct(data.db, kilogramItem).status, "SUGGESTED");
});

// Tests for handling similar products, ensuring they are suggested only when meeting minimum score and margin criteria.
test("similar products are suggestions only with sufficient score and margin", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  const first = data.addProduct("Milch", "Test und Brand", 1000, "ml");
  assert.equal(matchProduct(data.db, item).status, "SUGGESTED");
  assert.equal(matchProduct(data.db, item).candidates[0].productId, first);
  assert.equal(
    matchProduct(data.db, item, { minimumScore: 1.01 }).status,
    "NEW",
  );
  data.addProduct("Milch", "Test und Brand", 1, "l");
  assert.equal(matchProduct(data.db, item).status, "NEW");
});

// Tests for ambiguous product aliases, ensuring they never result in a matched product.
test("ambiguous product aliases never create a matched product", (t) => {
  const data = fixture();
  t.after(data.cleanup);
  data.addProduct("Milch", "Test und Brand", 1, "l", "milch 1 l");
  data.addProduct("Milch", "Test und Brand", 1, "l", "milch 1 l");
  assert.equal(matchProduct(data.db, item).status, "NEW");
  assert.equal(matchProduct(data.db, item).productId, null);
});
