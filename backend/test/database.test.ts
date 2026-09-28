import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";

// Test for database schema and indexes.
test("the initial migration creates the required schema and indexes", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-tracker-db-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));

  // Perform the initial migration and verify the database schema and indexes.
  try {
    migrate(db, { migrationsFolder: "./drizzle" });
    migrate(db, { migrationsFolder: "./drizzle" });

    // Verify the list of tables in the database.
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[];
    assert.deepEqual(
      tables
        .map((table) => table.name)
        .filter((name) => name !== "__drizzle_migrations")
        .sort(),
      [
        "brand",
        "category",
        "discount",
        "merchant",
        "merchant_alias",
        "product",
        "product_alias",
        "product_group",
        "receipt",
        "receipt_item",
        "warranty",
      ],
    );

    // Verify the columns of the receipt_item table.
    const receiptItemColumns = sqlite.pragma("table_info(receipt_item)") as {
      name: string;
      type: string;
      notnull: number;
    }[];
    assert.deepEqual(
      receiptItemColumns
        .filter((column) =>
          [
            "product_id",
            "quantity",
            "unit_price_cents",
            "total_price_cents",
          ].includes(column.name),
        )
        .map(({ name, type, notnull }) => ({ name, type, notnull })),
      [
        { name: "product_id", type: "INTEGER", notnull: 0 },
        { name: "quantity", type: "REAL", notnull: 1 },
        { name: "unit_price_cents", type: "INTEGER", notnull: 0 },
        { name: "total_price_cents", type: "INTEGER", notnull: 1 },
      ],
    );

    // Verify the foreign key constraints of the warranty table.
    const warrantyForeignKeys = sqlite.pragma("foreign_key_list(warranty)") as {
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }[];
    assert.deepEqual(
      warrantyForeignKeys.map(({ table, from, to, on_delete }) => ({
        table,
        from,
        to,
        on_delete,
      })),
      [
        {
          table: "receipt_item",
          from: "receipt_item_id",
          to: "id",
          on_delete: "NO ACTION",
        },
      ],
    );

    // Verify the foreign key constraints of the discount table.
    const indexes = sqlite
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
      )
      .all() as { name: string; sql: string }[];

    assert.deepEqual(indexes.map((index) => index.name).sort(), [
      "merchant_alias_normalized_alias_idx",
      "product_alias_normalized_alias_idx",
      "receipt_duplicate_candidate_idx",
    ]);
    assert.ok(
      indexes
        .find((index) => index.name === "receipt_duplicate_candidate_idx")!
        .sql.includes(
          "ON `receipt` (`merchant_id`,`purchase_date`,`total_cents`)",
        ),
    );

    assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
    assert.throws(
      () =>
        sqlite
          .prepare(
            "INSERT INTO warranty (receipt_item_id, type, start_date, end_date, created_at, updated_at) VALUES (999, 'statutory', '2026-01-01', '2028-01-01', 'now', 'now')",
          )
          .run(),
      { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
