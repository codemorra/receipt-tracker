import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";
import { normalizeAlias } from "../src/matching/alias-normalizer.js";

// Test for review lookups API endpoints
test("review lookups return selectable entities and filter by name", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-lookups-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { sqlite, db } = createDatabase(":memory:");
  t.after(() => sqlite.close());

  const now = "2026-09-29T00:00:00.000Z";
  const categoryId = (
    sqlite.prepare("SELECT id FROM category WHERE name = ?").get("food") as {
      id: number;
    }
  ).id;
  const merchantId = Number(
    sqlite
      .prepare(
        "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("Test Market", now, now).lastInsertRowid,
  );
  const brandId = Number(
    sqlite
      .prepare(
        "INSERT INTO brand (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("Test Brand", now, now).lastInsertRowid,
  );
  const groupId = Number(
    sqlite
      .prepare(
        "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(categoryId, "Milk", now, now).lastInsertRowid,
  );
  const productId = Number(
    sqlite
      .prepare(
        "INSERT INTO product (product_group_id, brand_id, name, package_amount, package_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(groupId, brandId, "Whole Milk", 1, "l", now, now).lastInsertRowid,
  );

  const scans = new ScanSessionService(join(directory, "scans"), {
    async requestPreview() {
      throw new Error("Unexpected preview request");
    },
    async requestProcess() {
      throw new Error("Unexpected process request");
    },
  });
  const app = createApp(
    scans,
    db,
    () => ({
      async extractReceipt() {
        throw new Error("Unexpected extraction request");
      },
    }),
    directory,
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const getJson = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    return response.json();
  };

  assert.ok(
    (await getJson("/api/categories")).some(
      (category: { id: number; name: string }) =>
        category.id === categoryId && category.name === "food",
    ),
  );
  assert.deepEqual(await getJson("/api/merchants?query=MARKET"), [
    { id: merchantId, name: "Test Market" },
  ]);
  assert.deepEqual(await getJson("/api/merchants?query=unknown"), []);
  // Restoring a URL selection must work even outside the first 50 lookup results.
  const insertExtraMerchant = sqlite.prepare(
    "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
  );
  let lastMerchantId = 0;
  for (let index = 0; index < 55; index++)
    lastMerchantId = Number(
      insertExtraMerchant.run(`Z-${String(index).padStart(2, "0")}`, now, now)
        .lastInsertRowid,
    );
  assert.equal((await getJson("/api/merchants")).length, 50);
  assert.deepEqual(await getJson(`/api/merchants?id=${lastMerchantId}`), [
    { id: lastMerchantId, name: "Z-54" },
  ]);
  assert.deepEqual(await getJson("/api/merchants?query=MARKET"), [
    { id: merchantId, name: "Test Market" },
  ]);
  for (const query of [
    "id=",
    "id=0",
    "id=-1",
    "id=1.5",
    "id=9007199254740992",
    "id=1&id=2",
  ]) {
    const response = await fetch(`${base}/api/merchants?${query}`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_merchant_query",
    });
  }
  const unknownMerchant = await fetch(`${base}/api/merchants?id=999999`);
  assert.equal(unknownMerchant.status, 404);
  assert.deepEqual(await unknownMerchant.json(), {
    error: "merchant_not_found",
  });
  assert.deepEqual(await getJson("/api/brands?query=brand"), [
    { id: brandId, name: "Test Brand" },
  ]);
  assert.deepEqual(await getJson("/api/product-groups?query=food"), [
    { id: groupId, name: "Milk", categoryId, categoryName: "food" },
  ]);
  assert.deepEqual(await getJson("/api/products?query=brand"), [
    {
      id: productId,
      name: "Whole Milk",
      productGroupId: groupId,
      productGroupName: "Milk",
      categoryId,
      categoryName: "food",
      brandId,
      brandName: "Test Brand",
      packageAmount: 1,
      packageUnit: "l",
    },
  ]);

  const originalProduct = await getJson("/api/products?query=Whole");
  const insertAlias = sqlite.prepare(
    "INSERT INTO product_alias (product_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const alias of ["MILCH-1L", "MILCH-2L", "SÜßE-MILCH"])
    insertAlias.run(productId, alias, normalizeAlias(alias), now);
  for (const query of [
    " WHOLE milk ",
    "MILK",
    "Test Brand",
    "milch",
    "MILCH 1 l",
    "suesse milch",
  ]) {
    assert.deepEqual(
      await getJson(`/api/products?query=${encodeURIComponent(query)}`),
      originalProduct,
      query,
    );
  }
  for (const query of ["no match", "%_", "' OR 1=1 --"])
    assert.deepEqual(
      await getJson(`/api/products?query=${encodeURIComponent(query)}`),
      [],
    );

  // Keep brand/group filtering and the import response shape, including nullable metadata.
  const bakeryBrandId = Number(
    sqlite
      .prepare(
        "INSERT INTO brand (name, created_at, updated_at) VALUES ('Bäcker & Söhne', ?, ?)",
      )
      .run(now, now).lastInsertRowid,
  );
  const bakeryGroupId = Number(
    sqlite
      .prepare(
        "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES (?, 'Süßes Gebäck', ?, ?)",
      )
      .run(categoryId, now, now).lastInsertRowid,
  );
  const bakeryProductId = Number(
    sqlite
      .prepare(
        "INSERT INTO product (product_group_id, brand_id, name, created_at, updated_at) VALUES (?, ?, 'Straßen-Brötchen', ?, ?)",
      )
      .run(bakeryGroupId, bakeryBrandId, now, now).lastInsertRowid,
  );
  const bakeryProduct = {
    id: bakeryProductId,
    name: "Straßen-Brötchen",
    productGroupId: bakeryGroupId,
    productGroupName: "Süßes Gebäck",
    categoryId,
    categoryName: "food",
    brandId: bakeryBrandId,
    brandName: "Bäcker & Söhne",
    packageAmount: null,
    packageUnit: null,
  };
  for (const query of [
    "STRASSEN BROETCHEN",
    "baecker und soehne",
    "sUeSsEs GeBaEcK",
  ])
    assert.deepEqual(
      await getJson(`/api/products?query=${encodeURIComponent(query)}`),
      [bakeryProduct],
    );

  const insertProduct = sqlite.prepare(
    "INSERT INTO product (product_group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const sameNameId = Number(
    insertProduct.run(groupId, "Whole Milk", now, now).lastInsertRowid,
  );
  const sameNameProduct = {
    ...originalProduct[0],
    id: sameNameId,
    brandId: null,
    brandName: null,
    packageAmount: null,
    packageUnit: null,
  };
  assert.deepEqual(await getJson("/api/products?query=whole"), [
    originalProduct[0],
    sameNameProduct,
  ]);
  assert.deepEqual(await getJson("/api/products?query=BRAND"), originalProduct);
  assert.deepEqual(await getJson("/api/products?query=MILK"), [
    originalProduct[0],
    sameNameProduct,
  ]);
  for (let index = 0; index < 55; index++)
    insertProduct.run(groupId, `Z-${String(index).padStart(2, "0")}`, now, now);
  const needleId = Number(
    insertProduct.run(groupId, "Zulu Needle", now, now).lastInsertRowid,
  );
  assert.equal((await getJson("/api/products")).length, 50);
  assert.deepEqual(
    await getJson("/api/products?query=%20%20%20"),
    await getJson("/api/products"),
  );
  assert.deepEqual(await getJson("/api/products?query=needle"), [
    { ...sameNameProduct, id: needleId, name: "Zulu Needle" },
  ]);
  insertAlias.run(
    needleId,
    "NEEDLE-ALIAS",
    normalizeAlias("NEEDLE-ALIAS"),
    now,
  );
  assert.equal(
    (await getJson("/api/products?query=NEEDLE-ALIAS"))[0].id,
    needleId,
  );

  const archiveDirectory = join(directory, "receipts", "2026", "09");
  await mkdir(archiveDirectory, { recursive: true });
  await writeFile(join(archiveDirectory, "1.webp"), "archive");
  const insertReceipt = sqlite.prepare(
    "INSERT INTO receipt (merchant_id, purchase_date, total_cents, currency, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const validId = Number(
    insertReceipt.run(
      merchantId,
      "2026-09-29",
      119,
      "EUR",
      "receipts/2026/09/1.webp",
      now,
      now,
    ).lastInsertRowid,
  );
  const image = await fetch(`${base}/api/receipts/${validId}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(await image.text(), "archive");

  const missingId = Number(
    insertReceipt.run(
      merchantId,
      "2026-09-29",
      119,
      "EUR",
      "receipts/2026/09/missing.webp",
      now,
      now,
    ).lastInsertRowid,
  );
  assert.equal(
    (await fetch(`${base}/api/receipts/${missingId}/image`)).status,
    404,
  );
  const outsideId = Number(
    insertReceipt.run(
      merchantId,
      "2026-09-29",
      119,
      "EUR",
      "../outside.webp",
      now,
      now,
    ).lastInsertRowid,
  );
  assert.equal(
    (await fetch(`${base}/api/receipts/${outsideId}/image`)).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/receipts/invalid/image`)).status, 404);
});
