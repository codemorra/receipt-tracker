import { count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import {
  merchantAliases,
  merchants,
  products,
  receiptItems,
  receipts,
  warranties,
} from "../db/schema.js";
import { normalizeAlias } from "../matching/alias-normalizer.js";
import { productNameOrAliasMatches } from "../lookups/product-search.js";

const PAGE_SIZE = 20;

/**
 * Lists receipt headers using canonical names and learned aliases, without multiplying receipt rows.
 * @param db The database instance to query.
 * @param search The search string to filter receipts by merchant or product names.
 * @param page The page number for pagination.
 * @returns An object containing the list of receipts and pagination metadata.
 */
export function listReceipts(db: Database, search = "", page = 1) {
  const query = normalizeAlias(search);
  const predicate = !search.trim()
    ? undefined
    : !query
      ? sql`0`
      : sql`
          instr(receipt_search_normalize(${merchants.name}), ${query}) > 0
          OR EXISTS (
            SELECT 1 FROM ${merchantAliases}
            WHERE ${merchantAliases.merchantId} = ${receipts.merchantId}
              AND instr(${merchantAliases.normalizedAlias}, ${query}) > 0
          )
          OR EXISTS (
            SELECT 1 FROM ${receiptItems}
            INNER JOIN ${products} ON ${products.id} = ${receiptItems.productId}
            WHERE ${receiptItems.receiptId} = ${receipts.id}
              AND ${productNameOrAliasMatches(query)}
          )
        `;

  return db.transaction((tx) => {
    const { totalItems } = tx
      .select({ totalItems: count() })
      .from(receipts)
      .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
      .where(predicate)
      .get()!;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const metadata = {
      page: totalItems === 0 ? 1 : page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages,
    };
    // Skip the offset calculation for out-of-range pages, including very large valid integers.
    const rows =
      page > totalPages
        ? []
        : tx
            .select({
              id: receipts.id,
              merchantId: merchants.id,
              merchantName: merchants.name,
              purchaseDate: receipts.purchaseDate,
              purchaseTime: receipts.purchaseTime,
              totalCents: receipts.totalCents,
              currency: receipts.currency,
            })
            .from(receipts)
            .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
            .where(predicate)
            .orderBy(
              desc(receipts.purchaseDate),
              desc(receipts.purchaseTime),
              desc(receipts.id),
            )
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
            .all();

    // Return the list of receipts along with their warranty counts and pagination metadata.
    const warrantyCounts = new Map(
      rows.length === 0
        ? []
        : tx
            .select({ receiptId: receiptItems.receiptId, count: count() })
            .from(receiptItems)
            .innerJoin(
              warranties,
              eq(warranties.receiptItemId, receiptItems.id),
            )
            .where(
              inArray(
                receiptItems.receiptId,
                rows.map((row) => row.id),
              ),
            )
            .groupBy(receiptItems.receiptId)
            .all()
            .map((row) => [row.receiptId, row.count] as const),
    );

    // Map each receipt to its corresponding warranty count, defaulting to 0 if none exist.
    return {
      items: rows.map((row) => ({
        ...row,
        warrantyCount: warrantyCounts.get(row.id) ?? 0,
      })),
      ...metadata,
    };
  });
}
