import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";

// Test for review lookups API endpoints
test("review lookups return selectable entities and filter by name", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-lookups-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { sqlite, db } = createDatabase(":memory:");
  t.after(() => sqlite.close());
  migrate(db, { migrationsFolder: "./drizzle" });

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
      .run("Edeka", now, now).lastInsertRowid,
  );
  const brandId = Number(
    sqlite
      .prepare(
        "INSERT INTO brand (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("Alpenhof", now, now).lastInsertRowid,
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
    {
      async extractReceipt() {
        throw new Error("Unexpected extraction request");
      },
    },
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
  assert.deepEqual(await getJson("/api/merchants?query=EDE"), [
    { id: merchantId, name: "Edeka" },
  ]);
  assert.deepEqual(await getJson("/api/merchants?query=unknown"), []);
  assert.deepEqual(await getJson("/api/brands?query=alpen"), [
    { id: brandId, name: "Alpenhof" },
  ]);
  assert.deepEqual(await getJson("/api/product-groups?query=food"), [
    { id: groupId, name: "Milk", categoryId, categoryName: "food" },
  ]);
  assert.deepEqual(await getJson("/api/products?query=alpen"), [
    {
      id: productId,
      name: "Whole Milk",
      productGroupId: groupId,
      productGroupName: "Milk",
      categoryId,
      categoryName: "food",
      brandId,
      brandName: "Alpenhof",
      packageAmount: 1,
      packageUnit: "l",
    },
  ]);

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
