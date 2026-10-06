import SqliteDatabase from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { normalizeAlias } from "../matching/alias-normalizer.js";
import * as schema from "./schema.js";

/**
 * Creates and returns a database connection along with the Drizzle ORM instance.
 * This function ensures that foreign key constraints are enabled and applies any pending migrations using Drizzle ORM.
 * @param filename - The path to the SQLite database file. Defaults to the value of the DATABASE_FILE environment variable or "./receipt-tracker.sqlite".
 * @returns An object containing the raw SQLite database instance and the Drizzle ORM instance.
 */
export function createDatabase(
  filename = process.env.DATABASE_FILE ?? "./receipt-tracker.sqlite",
) {
  const sqlite = new SqliteDatabase(filename);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.function(
      "receipt_search_normalize",
      { deterministic: true },
      normalizeAlias,
    );
    const db = drizzle(sqlite, { schema });
    migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle", import.meta.url),
      ),
    });
    return { sqlite, db };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
