import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";
import { loadExtractionReferenceData } from "../src/extraction/extraction-reference-data.js";

// Test for loading extraction reference data, ensuring only relevant category names are included and unrelated database data is excluded.
test("loads the current category names without unrelated database data", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-extraction-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));

  try {
    migrate(db, { migrationsFolder: "./drizzle" });
    sqlite
      .prepare("UPDATE category SET name = ? WHERE name = ?")
      .run("groceries", "food");
    sqlite
      .prepare(
        "INSERT INTO category (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("custom", "2026-09-29T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
    sqlite
      .prepare(
        "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run(
        "Private Merchant",
        "2026-09-29T00:00:00.000Z",
        "2026-09-29T00:00:00.000Z",
      );

    const referenceData = loadExtractionReferenceData(db);
    assert.deepEqual(Object.keys(referenceData), ["categoryNames"]);
    assert.ok(referenceData.categoryNames.includes("groceries"));
    assert.ok(referenceData.categoryNames.includes("custom"));
    assert.equal(referenceData.categoryNames.includes("food"), false);
    assert.equal(
      JSON.stringify(referenceData).includes("Private Merchant"),
      false,
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
