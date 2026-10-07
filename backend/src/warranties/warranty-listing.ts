import { and, asc, count, eq, or, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import {
  merchants,
  products,
  receiptItems,
  receipts,
  warranties,
} from "../db/schema.js";
import { productNameOrAliasMatches } from "../lookups/product-search.js";
import { normalizeAlias } from "../matching/alias-normalizer.js";
import type { WarrantyQuery } from "./warranty-query.js";
import {
  expiringSoonThrough,
  localCalendarDay,
  type WarrantyStatus,
} from "./warranty-status.js";

const PAGE_SIZE = 20;

/**
 * Lists warranties based on the given query and pagination parameters.
 * @param db The database instance to use for the query.
 * @param query The warranty query parameters.
 * @param today The current date for calculating warranty status.
 * @returns An object containing the list of warranties and pagination information.
 */
export function listWarranties(
  db: Database,
  query: WarrantyQuery = {},
  today = localCalendarDay(),
) {
  const through = expiringSoonThrough(today);
  const status = sql<WarrantyStatus>`CASE
    WHEN ${warranties.startDate} > ${today} THEN 'not_started'
    WHEN ${warranties.endDate} < ${today} THEN 'expired'
    WHEN ${warranties.endDate} <= ${through} THEN 'expiring_soon'
    ELSE 'active' END`;
  const search = normalizeAlias(query.search ?? "");
  const predicate = and(
    !query.search?.trim()
      ? undefined
      : !search
        ? sql`0`
        : or(
            productNameOrAliasMatches(search),
            sql`(${products.id} IS NULL AND instr(receipt_search_normalize(${receiptItems.rawName}), ${search}) > 0)`,
          ),
    query.status === undefined ? undefined : eq(status, query.status),
    query.type === undefined ? undefined : eq(warranties.type, query.type),
  );
  const page = query.page ?? 1;
  return db.transaction((tx) => {
    const { totalItems } = tx
      .select({ totalItems: count() })
      .from(warranties)
      .innerJoin(receiptItems, eq(warranties.receiptItemId, receiptItems.id))
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
      .leftJoin(products, eq(receiptItems.productId, products.id))
      .where(predicate)
      .get()!;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const items =
      page > totalPages
        ? []
        : tx
            .select({
              id: warranties.id,
              receiptId: receipts.id,
              receiptItemId: receiptItems.id,
              type: warranties.type,
              startDate: warranties.startDate,
              endDate: warranties.endDate,
              status,
              displayName: sql<string>`coalesce(${products.name}, ${receiptItems.rawName})`,
              merchantName: merchants.name,
              purchaseDate: receipts.purchaseDate,
            })
            .from(warranties)
            .innerJoin(
              receiptItems,
              eq(warranties.receiptItemId, receiptItems.id),
            )
            .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
            .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
            .leftJoin(products, eq(receiptItems.productId, products.id))
            .where(predicate)
            .orderBy(
              sql`CASE WHEN ${warranties.startDate} > ${today} THEN 1 WHEN ${warranties.endDate} < ${today} THEN 2 ELSE 0 END`,
              sql`CASE WHEN ${warranties.startDate} > ${today} THEN ${warranties.startDate} END ASC`,
              sql`CASE WHEN ${warranties.endDate} >= ${today} THEN ${warranties.endDate} END ASC`,
              sql`CASE WHEN ${warranties.endDate} < ${today} THEN ${warranties.endDate} END DESC`,
              asc(warranties.id),
            )
            .limit(PAGE_SIZE)
            .offset((page - 1) * PAGE_SIZE)
            .all();
    return {
      items,
      page: totalItems === 0 ? 1 : page,
      pageSize: PAGE_SIZE,
      totalItems,
      totalPages,
    };
  });
}
