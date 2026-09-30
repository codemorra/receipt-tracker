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
import { finalSaveSchema } from "../src/review/final-save.js";
import { loadReceiptDetail } from "../src/review/receipt-detail.js";
import {
  ConfirmedEntityNotFoundError,
  DuplicateConfirmationRequiredError,
  saveReceipt,
  ScanArchiveNotFoundError,
} from "../src/review/receipt-persistence.js";
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
      items: [{ ...validReceipt.items[0], productId: 999 }],
    }),
    ConfirmedEntityNotFoundError,
  );
  for (const table of [
    "merchant",
    "merchant_alias",
    "receipt",
    "receipt_item",
    "product",
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
    await readFile(
      join(data.dataRoot, "scans", data.scanId, "archive.webp"),
      "utf8",
    ),
    "archive-image",
  );
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
    {
      async extractReceipt() {
        throw new Error("unused");
      },
    },
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
    {
      async extractReceipt() {
        throw new Error("unused");
      },
    },
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
    {
      async extractReceipt() {
        throw new Error("unused");
      },
    },
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
