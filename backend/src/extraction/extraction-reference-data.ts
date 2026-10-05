import { asc } from "drizzle-orm";
import { categories } from "../db/schema.js";
import type { Database } from "../db/database.js";

/**
 * Loads reference data for extraction, such as category names.
 * @param db The database instance to query for reference data.
 * @returns An object containing arrays of reference data, such as category names.
 */
export function loadExtractionReferenceData(db: Database) {
  const categoryNames = db
    .select({ name: categories.name })
    .from(categories)
    .orderBy(asc(categories.id))
    .all()
    .map((category) => category.name);

  return { categoryNames };
}
