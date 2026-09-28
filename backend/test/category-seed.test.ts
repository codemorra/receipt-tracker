import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";

// Test to ensure that default categories are seeded correctly and can be modified.
test("default categories are seeded once and remain editable", () => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-tracker-seed-"));
  const { sqlite, db } = createDatabase(join(directory, "test.sqlite"));

  // Create a temporary database and apply migrations to seed default categories.
  try {
    migrate(db, { migrationsFolder: "./drizzle" });

    // Function to retrieve the list of category names from the database.
    const categoryNames = () =>
      (
        sqlite.prepare("SELECT name FROM category ORDER BY id").all() as {
          name: string;
        }[]
      ).map((category) => category.name);

    assert.deepEqual(categoryNames(), [
      "food",
      "beverages",
      "drugstore",
      "household",
      "pet_supplies",
      "electronics",
      "clothing",
      "home_and_garden",
      "automotive",
      "leisure",
      "gastronomy",
      "services",
      "other",
    ]);

    sqlite
      .prepare("UPDATE category SET name = ? WHERE name = ?")
      .run("groceries", "food");
    sqlite
      .prepare(
        "INSERT INTO category (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("custom", "2026-09-28T00:00:00.000Z", "2026-09-28T00:00:00.000Z");

    migrate(db, { migrationsFolder: "./drizzle" });

    assert.deepEqual(categoryNames(), [
      "groceries",
      "beverages",
      "drugstore",
      "household",
      "pet_supplies",
      "electronics",
      "clothing",
      "home_and_garden",
      "automotive",
      "leisure",
      "gastronomy",
      "services",
      "other",
      "custom",
    ]);
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
