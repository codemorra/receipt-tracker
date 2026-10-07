import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import { receipts } from "../src/db/schema.js";
import { saveReceipt } from "../src/receipts/receipt-save-service.js";
import { finalSaveSchema } from "../src/receipts/final-save.js";
import type { FinalSaveDto } from "../src/receipts/final-save.js";
import { loadReceiptDetail } from "../src/receipts/receipt-detail.js";
import { listReceipts } from "../src/receipts/receipt-listing.js";
import { persistReceipt } from "../src/receipts/receipt-persistence.js";
import { learnMerchantAlias } from "../src/matching/alias-learning.js";
import {
  ConfirmedEntityNotFoundError,
  DuplicateConfirmationRequiredError,
  ScanArchiveNotFoundError,
} from "../src/receipts/receipt-errors.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";

const validReceipt = {
  merchant: { id: null, name: "Edeka", rawName: "EDEKA CITY" },
  purchaseDate: "2026-09-30",
  purchaseTime: "12:30",
  totalCents: 199,
  currency: "EUR",
  items: [
    {
      rawName: "MILCH 1L",
      productId: null,
      productName: "Milch",
      brandId: null,
      brandName: "Gut & Günstig",
      productGroupId: null,
      productGroupName: "milk",
      categoryName: "food",
      packageAmount: 1,
      packageUnit: "l",
      quantity: 2,
      unit: "pcs",
      unitPriceCents: 109,
      totalPriceCents: 218,
      lineType: "product",
      warranties: [
        {
          type: "statutory",
          startDate: "2026-09-30",
          endDate: "2028-09-30",
          notes: "test",
        },
      ],
    },
  ],
  discounts: [
    { description: "Aktion", amountCents: 19, appliesToItemIndex: 0 },
  ],
};

// Fixture for setting up a temporary environment for testing receipt persistence
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "receipt-save-"));
  const dataRoot = join(root, "data");
  const scansRoot = join(dataRoot, "scans");
  async function createScan() {
    const id = randomUUID();
    const directory = join(scansRoot, id);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "session.json"), "{}");
    await writeFile(join(directory, "archive.webp"), "archive-image");
    return id;
  }
  const scanId = await createScan();
  const { sqlite, db } = createDatabase(join(root, "test.sqlite"));
  const scans = new ScanSessionService(scansRoot, {
    async requestPreview() {
      throw new Error("unused");
    },
    async requestProcess() {
      throw new Error("unused");
    },
  });
  return {
    root,
    dataRoot,
    scanId,
    createScan,
    scans,
    db,
    sqlite,
    async cleanup() {
      sqlite.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

// Test cases for validating the final save schema and the saveReceipt function
test("final save rejects incomplete products, invalid warranties, and invalid discount references", () => {
  assert.ok(finalSaveSchema.safeParse(validReceipt).success);
  assert.ok(
    !finalSaveSchema.safeParse({ ...validReceipt, purchaseDate: "2026-02-30" })
      .success,
  );
  assert.ok(
    !finalSaveSchema.safeParse({
      ...validReceipt,
      items: [{ ...validReceipt.items[0], productGroupName: null }],
    }).success,
  );
  assert.ok(
    !finalSaveSchema.safeParse({
      ...validReceipt,
      items: [
        {
          ...validReceipt.items[0],
          warranties: [
            { ...validReceipt.items[0].warranties[0], endDate: "2025-01-01" },
          ],
        },
      ],
    }).success,
  );
  assert.ok(
    !finalSaveSchema.safeParse({
      ...validReceipt,
      discounts: [{ ...validReceipt.discounts[0], appliesToItemIndex: 1 }],
    }).success,
  );
  assert.ok(
    !finalSaveSchema.safeParse({ ...validReceipt, extra: true }).success,
  );
});

// Test for validating that the final save schema correctly enforces product line warranties.
test("final save only accepts warranties on product lines", () => {
  assert.equal(finalSaveSchema.safeParse(validReceipt).success, true);
  for (const lineType of ["deposit", "fee", "other"]) {
    assert.equal(
      finalSaveSchema.safeParse({
        ...validReceipt,
        items: [{ ...validReceipt.items[0], lineType }],
      }).success,
      false,
    );
    assert.equal(
      finalSaveSchema.safeParse({
        ...validReceipt,
        items: [{ ...validReceipt.items[0], lineType, warranties: [] }],
      }).success,
      true,
    );
  }
});

// Test case for verifying that saveReceipt correctly persists all related entities and the receipt archive
test("save persists confirmed entities, aliases, receipt rows, warranty, and archive", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const receiptId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  const receipt = data.db
    .select()
    .from(receipts)
    .where(eq(receipts.id, receiptId))
    .get();
  assert.ok(receipt);
  assert.equal(receipt.merchantRawName, "EDEKA CITY");
  assert.equal(receipt.totalCents, 199);
  assert.equal(
    await readFile(join(data.dataRoot, receipt.imagePath), "utf8"),
    "archive-image",
  );
  assert.deepEqual(await readdir(join(data.dataRoot, "scans")), []);
  const count = (table: string) =>
    (
      data.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  for (const table of [
    "merchant",
    "merchant_alias",
    "product_group",
    "brand",
    "product",
    "product_alias",
    "receipt",
    "receipt_item",
    "discount",
    "warranty",
  ]) {
    assert.equal(count(table), 1, table);
  }
  const discount = data.sqlite
    .prepare("SELECT receipt_item_id AS itemId FROM discount")
    .get() as { itemId: number };
  const item = data.sqlite
    .prepare("SELECT id, product_id AS productId FROM receipt_item")
    .get() as { id: number; productId: number };
  assert.equal(discount.itemId, item.id);
  assert.ok(item.productId > 0);
  assert.equal(
    (
      data.sqlite
        .prepare("SELECT normalized_alias AS alias FROM merchant_alias")
        .get() as { alias: string }
    ).alias,
    "edeka city",
  );
  assert.equal(
    (
      data.sqlite
        .prepare("SELECT normalized_alias AS alias FROM product_alias")
        .get() as { alias: string }
    ).alias,
    "milch 1 l",
  );
});

// Test for ensuring that identical new products share an ID while retaining receipt items and aliases.
test("identical new products share an ID while retaining receipt items and aliases", async (t) => {
  for (const rawNames of [
    ["MILCH 1L", "MILCH 1L"],
    ["MILCH 1L", "MILCH 1L", "FRESH MILK"],
  ]) {
    await t.test(`${rawNames.length} positions`, async (t) => {
      const data = await fixture();
      t.after(data.cleanup);
      const input = finalSaveSchema.parse({
        ...validReceipt,
        items: rawNames.map((rawName, index) => ({
          ...validReceipt.items[0],
          rawName,
          quantity: index + 1,
          unitPriceCents: 100 + index,
          totalPriceCents: (index + 1) * (100 + index),
        })),
      });
      const receiptId = await saveReceipt(
        data.db,
        data.scans,
        data.dataRoot,
        data.scanId,
        input,
      );
      const detail = loadReceiptDetail(data.db, receiptId)!;
      assert.equal(detail.items.length, rawNames.length);
      assert.equal(
        new Set(detail.items.map((item) => item.id)).size,
        rawNames.length,
      );
      assert.equal(
        new Set(detail.items.map((item) => item.product!.id)).size,
        1,
      );
      assert.deepEqual(
        detail.items.map((item) => ({
          rawName: item.rawName,
          position: item.position,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
        })),
        input.items.map((item, position) => ({
          rawName: item.rawName,
          position,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
        })),
      );
      assert.deepEqual(
        data.sqlite.prepare("SELECT COUNT(*) AS count FROM product").get(),
        { count: 1 },
      );
      assert.deepEqual(
        data.sqlite
          .prepare(
            "SELECT product_id AS productId, normalized_alias AS alias FROM product_alias ORDER BY id",
          )
          .all(),
        [...new Set(rawNames)].map((rawName) => ({
          productId: detail.items[0].product!.id,
          alias: rawName === "FRESH MILK" ? "fresh milk" : "milch 1 l",
        })),
      );
      assert.equal(detail.discounts[0].receiptItemId, detail.items[0].id);
      assert.ok(detail.items.every((item) => item.warranties.length === 1));
      const reopened = createDatabase(join(data.root, "test.sqlite"));
      try {
        assert.deepEqual(loadReceiptDetail(reopened.db, receiptId), detail);
      } finally {
        reopened.sqlite.close();
      }
    });
  }
});

// Test for ensuring that new products with different identities remain separate.
test("new products with different identities remain separate", async (t) => {
  const differences: [string, Partial<FinalSaveDto["items"][number]>][] = [
    ["name", { productName: "Andere Milch" }],
    ["brand", { brandName: "Other" }],
    ["unknown brand", { brandName: null }],
    ["package size", { packageAmount: 500, packageUnit: "ml" }],
    ["unknown package", { packageAmount: null, packageUnit: null }],
    ["group", { productGroupName: "other milk" }],
    ["category", { categoryName: "other food" }],
  ];
  for (const [name, difference] of differences) {
    await t.test(name, async (t) => {
      const data = await fixture();
      t.after(data.cleanup);
      const receiptId = persistReceipt(
        data.db,
        finalSaveSchema.parse({
          ...validReceipt,
          items: [
            validReceipt.items[0],
            { ...validReceipt.items[0], ...difference },
          ],
        }),
        "receipts/test.webp",
      );
      const detail = loadReceiptDetail(data.db, receiptId)!;
      assert.equal(detail.items.length, 2);
      assert.notEqual(detail.items[0].product!.id, detail.items[1].product!.id);
      assert.deepEqual(
        data.sqlite.prepare("SELECT COUNT(*) AS count FROM product").get(),
        { count: 2 },
      );
    });
  }
});

// Test for ensuring that new products reuse resolved brand and group IDs and equivalent packages.
test("new products reuse resolved brand and group IDs and equivalent packages", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const now = "2026-09-30";
  const categoryId = Number(
    data.sqlite
      .prepare(
        "INSERT INTO category (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("identity food", now, now).lastInsertRowid,
  );
  const groupId = Number(
    data.sqlite
      .prepare(
        "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(categoryId, "milk", now, now).lastInsertRowid,
  );
  const brandId = Number(
    data.sqlite
      .prepare(
        "INSERT INTO brand (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("Gut & Günstig", now, now).lastInsertRowid,
  );
  const receiptId = persistReceipt(
    data.db,
    finalSaveSchema.parse({
      ...validReceipt,
      items: [
        { ...validReceipt.items[0], categoryName: "identity food" },
        {
          ...validReceipt.items[0],
          categoryName: "identity food",
          brandId,
          productGroupId: groupId,
          packageAmount: 1000,
          packageUnit: "ml",
        },
      ],
    }),
    "receipts/test.webp",
  );
  const detail = loadReceiptDetail(data.db, receiptId)!;
  assert.equal(detail.items[0].product!.id, detail.items[1].product!.id);
  assert.deepEqual(
    data.sqlite.prepare("SELECT COUNT(*) AS count FROM product").get(),
    { count: 1 },
  );
  assert.equal(detail.items[0].product!.packageAmount, 1);
  assert.equal(detail.items[0].product!.packageUnit, "l");
});

// Test for ensuring that explicit product IDs and new products stay distinct across saves.
test("explicit product IDs and new products stay distinct across saves", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const save = (items: FinalSaveDto["items"]) =>
    persistReceipt(
      data.db,
      finalSaveSchema.parse({
        ...validReceipt,
        items,
      }),
      "receipts/test.webp",
    );
  const item = finalSaveSchema.parse(validReceipt).items[0];
  const firstId = loadReceiptDetail(data.db, save([item]))!.items[0].product!
    .id;
  const secondId = loadReceiptDetail(data.db, save([item]))!.items[0].product!
    .id;
  assert.notEqual(firstId, secondId);
  // New positions surround the explicit selections to cover both processing orders.
  const detail = loadReceiptDetail(
    data.db,
    save([
      item,
      { ...item, productId: firstId },
      { ...item, productId: secondId },
      item,
    ]),
  )!;
  const ids = detail.items.map((entry) => entry.product!.id);
  assert.equal(ids[1], firstId);
  assert.equal(ids[2], secondId);
  assert.equal(ids[0], ids[3]);
  assert.notEqual(ids[0], firstId);
  assert.notEqual(ids[0], secondId);
  assert.deepEqual(
    data.sqlite.prepare("SELECT COUNT(*) AS count FROM product").get(),
    { count: 3 },
  );
});

// Test case for verifying that confirmed existing entities are reused without creating duplicate aliases
test("confirmed existing entities are reused without duplicate aliases", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const firstId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  const first = data.db
    .select()
    .from(receipts)
    .where(eq(receipts.id, firstId))
    .get()!;
  const productId = (
    data.sqlite.prepare("SELECT id FROM product").get() as { id: number }
  ).id;
  await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    await data.createScan(),
    {
      ...validReceipt,
      merchant: { ...validReceipt.merchant, id: first.merchantId },
      items: [{ ...validReceipt.items[0], productId }],
      duplicateOverride: true,
    },
  );
  for (const table of [
    "merchant",
    "merchant_alias",
    "product",
    "product_alias",
  ]) {
    assert.equal(
      (
        data.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count,
      1,
      table,
    );
  }
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    2,
  );
});

// Test case for verifying that a failed entity resolution rolls back all reference data and removes the copied archive
test("failed entity resolution rolls back reference data and removes the copied archive", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  await assert.rejects(
    saveReceipt(data.db, data.scans, data.dataRoot, data.scanId, {
      ...validReceipt,
      items: [
        { ...validReceipt.items[0], categoryName: "rollback category" },
        { ...validReceipt.items[0], categoryName: "rollback category" },
        { ...validReceipt.items[0], productId: 999 },
      ],
    }),
    ConfirmedEntityNotFoundError,
  );
  for (const table of [
    "merchant",
    "merchant_alias",
    "receipt",
    "receipt_item",
    "product",
    "product_alias",
    "product_group",
    "brand",
    "warranty",
    "discount",
  ]) {
    assert.equal(
      (
        data.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count,
      0,
      table,
    );
  }
  assert.deepEqual(await readdir(join(data.dataRoot, "receipts")), []);
  assert.equal(
    data.sqlite
      .prepare("SELECT id FROM category WHERE name = ?")
      .get("rollback category"),
    undefined,
  );
  assert.equal(
    await readFile(
      join(data.dataRoot, "scans", data.scanId, "archive.webp"),
      "utf8",
    ),
    "archive-image",
  );
});

// Test case for verifying that failed scan cleanup is logged after the receipt has been saved
test("logs failed scan cleanup after the receipt has been saved", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  t.mock.method(data.scans, "cancel", async () => {
    throw new Error("private receipt text");
  });
  const events: string[] = [];
  const receiptId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
    (level, operation, fields) => {
      events.push(JSON.stringify({ level, operation, fields }));
    },
  );
  assert.ok(receiptId > 0);
  assert.ok(
    events.some((event) =>
      event.includes('"operation":"receipt.scan_cleanup.failed"'),
    ),
  );
  assert.equal(events.join("\n").includes("private receipt text"), false);
});

// Test case for verifying that a missing scan archive prevents receipt data creation
test("missing scan archive does not create receipt data", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  await rm(join(data.dataRoot, "scans", data.scanId, "archive.webp"));
  await assert.rejects(
    saveReceipt(data.db, data.scans, data.dataRoot, data.scanId, validReceipt),
    ScanArchiveNotFoundError,
  );
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    0,
  );
});

// Test case for verifying that the confirm API validates requests and returns a saved receipt image
test("confirm API validates requests and returns a saved receipt image", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const app = createApp(
    data.scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("unused");
      },
    }),
    data.dataRoot,
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const confirm = (body: unknown) =>
    fetch(`${base}/api/scans/${data.scanId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal((await confirm({})).status, 400);
  const saved = await confirm(validReceipt);
  assert.equal(saved.status, 201);
  const { receiptId } = (await saved.json()) as { receiptId: number };
  const image = await fetch(`${base}/api/receipts/${receiptId}/image`);
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "archive-image");
  const detailResponse = await fetch(`${base}/api/receipts/${receiptId}`);
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()) as {
    merchantName: string;
    purchaseDate: string;
    purchaseTime: string;
    totalCents: number;
    currency: string;
    imageUrl: string;
    items: {
      quantity: number;
      unitPriceCents: number;
      totalPriceCents: number;
      product: {
        name: string;
        brandName: string;
        productGroupName: string;
        categoryName: string;
        packageAmount: number;
        packageUnit: string;
      };
      warranties: { type: string; endDate: string }[];
    }[];
    discounts: { amountCents: number; receiptItemId: number }[];
  };
  assert.equal(detail.merchantName, "Edeka");
  assert.equal(detail.purchaseDate, "2026-09-30");
  assert.equal(detail.purchaseTime, "12:30");
  assert.equal(detail.totalCents, 199);
  assert.equal(detail.currency, "EUR");
  assert.equal(detail.imageUrl, `/api/receipts/${receiptId}/image`);
  assert.equal(detail.items[0].quantity, 2);
  assert.equal(detail.items[0].unitPriceCents, 109);
  assert.equal(detail.items[0].totalPriceCents, 218);
  assert.deepEqual(detail.items[0].product, {
    id: 1,
    name: "Milch",
    brandName: "Gut & Günstig",
    productGroupName: "milk",
    categoryName: "food",
    packageAmount: 1,
    packageUnit: "l",
  });
  assert.equal(detail.items[0].warranties[0].type, "statutory");
  assert.equal(detail.items[0].warranties[0].endDate, "2028-09-30");
  assert.equal(detail.discounts[0].amountCents, 19);
  assert.ok(detail.discounts[0].receiptItemId > 0);
  assert.equal((await fetch(`${base}/api/receipts/999999`)).status, 404);
  assert.deepEqual(await readdir(join(data.dataRoot, "scans")), []);
  assert.equal((await confirm(validReceipt)).status, 404);
});

// Test case for verifying that the final save requires an explicit override for a persisted duplicate
test("final save requires an explicit override for a persisted duplicate", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const firstId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  const merchantId = data.db
    .select()
    .from(receipts)
    .where(eq(receipts.id, firstId))
    .get()!.merchantId;
  const duplicate = {
    ...validReceipt,
    merchant: { ...validReceipt.merchant, id: merchantId },
    purchaseTime: "13:15",
  };
  const duplicateScanId = await data.createScan();
  await assert.rejects(
    saveReceipt(data.db, data.scans, data.dataRoot, duplicateScanId, duplicate),
    (error: unknown) => {
      assert.ok(error instanceof DuplicateConfirmationRequiredError);
      assert.equal(error.candidates[0].receiptId, firstId);
      assert.equal(error.candidates[0].items[0].rawName, "MILCH 1L");
      return true;
    },
  );
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    1,
  );
  assert.equal((await readdir(join(data.dataRoot, "receipts"))).length, 1);
  const secondId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    duplicateScanId,
    { ...duplicate, duplicateOverride: true },
  );
  assert.notEqual(secondId, firstId);
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    2,
  );
});

// Test case for verifying that a new merchant without a confirmed match skips duplicate comparison
test("new merchant without a confirmed match skips duplicate comparison", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    await data.createScan(),
    validReceipt,
  );
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    2,
  );
});

// Test case for verifying that the confirm API returns current duplicate candidates after final edits
test("confirm API returns current duplicate candidates after final edits", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const firstId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  const merchantId = data.db
    .select()
    .from(receipts)
    .where(eq(receipts.id, firstId))
    .get()!.merchantId;
  const app = createApp(
    data.scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("unused");
      },
    }),
    data.dataRoot,
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const secondScanId = await data.createScan();
  const url = `http://127.0.0.1:${address.port}/api/scans/${secondScanId}/confirm`;
  const finalEdit = {
    ...validReceipt,
    merchant: { ...validReceipt.merchant, id: merchantId },
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(finalEdit),
  });
  assert.equal(response.status, 409);
  const body = (await response.json()) as {
    error: string;
    candidates: { receiptId: number }[];
  };
  assert.equal(body.error, "duplicate_confirmation_required");
  assert.equal(body.candidates[0].receiptId, firstId);
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...finalEdit, duplicateOverride: true }),
      })
    ).status,
    201,
  );
});

// Test case for verifying that cancelling a scan removes temporary files without storing a receipt
test("cancel scan removes temporary files without storing a receipt", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const app = createApp(
    data.scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("unused");
      },
    }),
    data.dataRoot,
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/scans/${data.scanId}`;
  assert.equal((await fetch(url, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(url, { method: "DELETE" })).status, 404);
  assert.deepEqual(await readdir(join(data.dataRoot, "scans")), []);
  assert.equal(
    (
      data.sqlite.prepare("SELECT COUNT(*) AS count FROM receipt").get() as {
        count: number;
      }
    ).count,
    0,
  );
});

// Test case for verifying that saved receipt details can be reloaded from a new database connection.
test("saved receipt detail reloads from a new database connection", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const receiptId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    {
      ...validReceipt,
      discounts: [
        ...validReceipt.discounts,
        { description: "Coupon", amountCents: 10, appliesToItemIndex: null },
      ],
    },
  );
  const reopened = createDatabase(join(data.root, "test.sqlite"));
  try {
    const detail = loadReceiptDetail(reopened.db, receiptId);
    assert.ok(detail);
    assert.equal(detail.merchantName, "Edeka");
    assert.equal(detail.items[0].product?.name, "Milch");
    assert.equal(detail.items[0].warranties[0].startDate, "2026-09-30");
    assert.equal(detail.discounts[0].amountCents, 19);
    assert.equal(detail.discounts[1].amountCents, 10);
    assert.equal(detail.discounts[1].receiptItemId, null);
    assert.equal(loadReceiptDetail(reopened.db, receiptId + 100), null);
  } finally {
    reopened.sqlite.close();
  }
});

// Test case for verifying that receipt listing correctly searches by merchant and product names, respects learned aliases, maintains stable pagination, and includes warranty counts.
test("receipt listing searches names and learned aliases with stable pagination and warranty counts", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const firstInput = {
    ...validReceipt,
    merchant: { id: null, name: "Bäcker Straße", rawName: "MARKT-17" },
    purchaseDate: "2026-09-29",
    purchaseTime: "23:59",
    items: [
      {
        ...validReceipt.items[0],
        productName: "Süße Milch",
        rawName: "DRINK-1L",
      },
      {
        ...validReceipt.items[0],
        productName: "Süße Milch",
        rawName: "DRINK-2L",
        warranties: [],
      },
    ],
  };
  const firstId = persistReceipt(
    data.db,
    finalSaveSchema.parse(firstInput),
    "receipts/first.webp",
  );
  const detail = loadReceiptDetail(data.db, firstId)!;
  data.db.transaction((tx) => {
    learnMerchantAlias(tx, detail.merchantId, "MARKT-18", "now");
  });
  const ids = [firstId];
  for (let index = 1; index < 25; index++) {
    ids.push(
      persistReceipt(
        data.db,
        finalSaveSchema.parse({
          ...firstInput,
          merchant: {
            ...firstInput.merchant,
            id: detail.merchantId,
            rawName: "OTHER MERCHANT LABEL",
          },
          purchaseDate: index === 1 ? "2026-10-01" : "2026-09-30",
          purchaseTime: index <= 2 ? null : "12:30",
          duplicateOverride: true,
          items: firstInput.items.map((item, position) => ({
            ...item,
            productId: detail.items[position].product!.id,
            rawName: "OTHER PRODUCT LABEL",
            warranties:
              index === 1
                ? Array.from(
                    { length: position === 0 ? 2 : 1 },
                    () => validReceipt.items[0].warranties[0],
                  )
                : [],
          })),
        }),
        `receipts/${index}.webp`,
      ),
    );
  }
  const unrelatedId = persistReceipt(
    data.db,
    finalSaveSchema.parse({
      ...validReceipt,
      merchant: { id: null, name: "Unrelated", rawName: null },
      purchaseDate: "2026-09-28",
      items: [{ ...validReceipt.items[0], lineType: "fee", warranties: [] }],
    }),
    "receipts/unrelated.webp",
  );
  const expectedIds = [ids[1], ...ids.slice(3).reverse(), ids[2], ids[0]];

  // Every path finds the same receipts even though later receipts use different raw labels.
  for (const search of [
    "  BÄCKER STRASSE  ",
    "mArKt",
    "SÜSSE MILCH",
    "dRiNk",
  ]) {
    for (const [page, expected] of [
      [1, expectedIds.slice(0, 20)],
      [2, expectedIds.slice(20)],
      [3, []],
      [Number.MAX_SAFE_INTEGER, []],
    ] as const) {
      const result = listReceipts(data.db, search, page);
      assert.deepEqual(
        result.items.map((item) => item.id),
        expected,
        `${search}, page ${page}`,
      );
      assert.deepEqual(
        {
          page: result.page,
          pageSize: result.pageSize,
          totalItems: result.totalItems,
          totalPages: result.totalPages,
        },
        { page, pageSize: 20, totalItems: 25, totalPages: 2 },
      );
      for (const item of result.items) {
        assert.equal(
          item.warrantyCount,
          item.id === ids[1] ? 3 : item.id === ids[0] ? 1 : 0,
        );
      }
    }
  }
  for (const search of ["", "   "]) {
    const pages = [
      listReceipts(data.db, search),
      listReceipts(data.db, search, 2),
    ];
    assert.deepEqual(
      pages.flatMap((page) => page.items.map((item) => item.id)),
      [...expectedIds, unrelatedId],
    );
    assert.equal(pages[0].totalItems, 26);
    assert.equal(pages[0].totalPages, 2);
    assert.deepEqual(listReceipts(data.db, search), pages[0]);
  }
  for (const search of ["no match", "%_", "' OR 1=1 --"]) {
    assert.deepEqual(listReceipts(data.db, search, 7), {
      items: [],
      page: 1,
      pageSize: 20,
      totalItems: 0,
      totalPages: 0,
    });
  }
  assert.deepEqual(listReceipts(data.db).items[0], {
    id: ids[1],
    merchantId: detail.merchantId,
    merchantName: "Bäcker Straße",
    purchaseDate: "2026-10-01",
    purchaseTime: null,
    totalCents: 199,
    currency: "EUR",
    warrantyCount: 3,
  });
  // A new connection must register the same receipt-search normalizer.
  const reopened = createDatabase(join(data.root, "test.sqlite"));
  try {
    assert.deepEqual(
      listReceipts(reopened.db, "SÜSSE MILCH"),
      listReceipts(data.db, "SÜSSE MILCH"),
    );
  } finally {
    reopened.sqlite.close();
  }
});

// Test case for verifying that the receipt listing API validates queries and correctly handles empty and out-of-range pagination metadata.
test("receipt listing API validates queries and preserves empty and out-of-range metadata", async (t) => {
  const data = await fixture();
  t.after(data.cleanup);
  const events: string[] = [];
  const app = createApp(
    data.scans,
    data.db,
    () => ({
      async extractReceipt() {
        throw new Error("unused");
      },
    }),
    data.dataRoot,
    (_level, operation) => {
      events.push(operation);
    },
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/receipts`;
  assert.deepEqual(await (await fetch(`${url}?page=9`)).json(), {
    items: [],
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });
  for (const query of [
    "page=0",
    "page=-1",
    "page=abc",
    "page=",
    "page=1.5",
    "page=1e2",
    "page=9007199254740992",
    "page=1&page=2",
    "search=a&search=b",
  ]) {
    const response = await fetch(`${url}?${query}`);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: "invalid_receipt_query" });
  }
  const receiptId = await saveReceipt(
    data.db,
    data.scans,
    data.dataRoot,
    data.scanId,
    validReceipt,
  );
  for (const query of [
    "",
    "?search=EDEKA%20CITY",
    "?search=MILCH%201L&page=1",
  ]) {
    const response = await fetch(`${url}${query}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [
        {
          id: receiptId,
          merchantId: 1,
          merchantName: "Edeka",
          purchaseDate: "2026-09-30",
          purchaseTime: "12:30",
          totalCents: 199,
          currency: "EUR",
          warrantyCount: 1,
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
  }
  for (const page of [2, Number.MAX_SAFE_INTEGER]) {
    const response = await fetch(`${url}?page=${page}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      items: [],
      page,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });
  }
  // Exercise the route's own database failure path without breaking fixture cleanup.
  data.sqlite.exec("ALTER TABLE receipt RENAME TO unavailable_receipt");
  const failed = await fetch(url);
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "receipt_list_failed" });
  assert.ok(events.includes("receipt.list.failed"));
});
