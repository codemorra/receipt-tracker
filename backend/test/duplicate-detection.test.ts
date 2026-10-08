import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";
import { findDuplicateCandidates } from "../src/receipts/duplicate-detection.js";

const now = "2026-09-29T00:00:00.000Z";

// Tests for the duplicate receipt detection functionality.
test("duplicate search uses merchant, date, and total while ranking by purchase time", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-duplicate-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));
  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  migrate(db, { migrationsFolder: "./drizzle" });

  const addMerchant = (name: string) =>
    Number(
      sqlite
        .prepare(
          "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
        )
        .run(name, now, now).lastInsertRowid,
    );
  const merchantId = addMerchant("Test Market");
  const otherMerchantId = addMerchant("Other");
  const addReceipt = (
    merchant: number,
    date: string,
    time: string | null,
    total: number,
  ) =>
    Number(
      sqlite
        .prepare(
          "INSERT INTO receipt (merchant_id, purchase_date, purchase_time, total_cents, currency, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          merchant,
          date,
          time,
          total,
          "EUR",
          `receipts/${time ?? "unknown"}.webp`,
          now,
          now,
        ).lastInsertRowid,
    );
  const missingTimeId = addReceipt(merchantId, "2026-09-29", null, 119);
  const nearTimeId = addReceipt(merchantId, "2026-09-29", "14:08", 119);
  const exactTimeId = addReceipt(merchantId, "2026-09-29", "14:05", 119);
  addReceipt(otherMerchantId, "2026-09-29", "14:05", 119);
  addReceipt(merchantId, "2026-09-28", "14:05", 119);
  addReceipt(merchantId, "2026-09-29", "14:05", 120);
  sqlite
    .prepare(
      "INSERT INTO receipt_item (receipt_id, position, raw_name, quantity, unit, unit_price_cents, total_price_cents, line_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(exactTimeId, 0, "MILCH 1L", 1, "pcs", 119, 119, "product", now, now);

  const input = {
    merchantId,
    purchaseDate: "2026-09-29",
    purchaseTime: "14:05",
    totalCents: 119,
  };
  const candidates = findDuplicateCandidates(db, input);
  assert.deepEqual(
    candidates.map((candidate) => candidate.receiptId),
    [exactTimeId, nearTimeId, missingTimeId],
  );
  assert.equal(candidates[0].merchantName, "Test Market");
  assert.equal(candidates[0].imagePath, "receipts/14:05.webp");
  assert.deepEqual(candidates[0].items, [
    {
      position: 0,
      rawName: "MILCH 1L",
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 119,
      totalPriceCents: 119,
      lineType: "product",
      productId: null,
    },
  ]);
  assert.deepEqual(
    findDuplicateCandidates(db, { ...input, purchaseTime: null }).map(
      (candidate) => candidate.receiptId,
    ),
    [missingTimeId, nearTimeId, exactTimeId],
  );
});

// Additional tests for edge cases and incomplete identity scenarios.
test("duplicate search skips incomplete identity and keeps candidates as warnings", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-duplicate-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));
  t.after(() => {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });
  migrate(db, { migrationsFolder: "./drizzle" });
  assert.deepEqual(
    findDuplicateCandidates(db, {
      merchantId: null,
      purchaseDate: "2026-09-29",
      purchaseTime: "14:05",
      totalCents: 119,
    }),
    [],
  );
  assert.deepEqual(
    findDuplicateCandidates(db, {
      merchantId: 1,
      purchaseDate: null,
      purchaseTime: "14:05",
      totalCents: 119,
    }),
    [],
  );
  assert.deepEqual(
    findDuplicateCandidates(db, {
      merchantId: 1,
      purchaseDate: "2026-09-29",
      purchaseTime: "14:05",
      totalCents: null,
    }),
    [],
  );
});
