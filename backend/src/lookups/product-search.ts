import { sql } from "drizzle-orm";
import { productAliases, products } from "../db/schema.js";

/**
 * Constructs a SQL expression to check if a product's name or any of its aliases matches the normalized query string.
 * @param normalizedQuery The normalized query string to match against product names and aliases.
 * @returns A SQL expression that evaluates to true if the product name or any alias contains the normalized query substring.
 */
export function productNameOrAliasMatches(normalizedQuery: string) {
  return sql`(
    instr(receipt_search_normalize(${products.name}), ${normalizedQuery}) > 0
    OR EXISTS (
      SELECT 1 FROM ${productAliases}
      WHERE ${productAliases.productId} = ${products.id}
        AND instr(${productAliases.normalizedAlias}, ${normalizedQuery}) > 0
    )
  )`;
}
