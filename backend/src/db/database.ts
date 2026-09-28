import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/**
 * Creates and returns a database connection along with the Drizzle ORM instance.
 * @param filename - The path to the SQLite database file. Defaults to the value of the DATABASE_FILE environment variable or "./receipt-tracker.sqlite".
 * @returns An object containing the raw SQLite database instance and the Drizzle ORM instance.
 */
export function createDatabase(
  filename = process.env.DATABASE_FILE ?? "./receipt-tracker.sqlite",
) {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
