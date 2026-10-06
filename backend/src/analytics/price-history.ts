import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../db/database.js";
import {
  brands,
  merchants,
  productGroups,
  products,
  receiptItems,
  receipts,
} from "../db/schema.js";
import type { PriceHistoryQuery } from "./analytics-query.js";

// Interface representing the structure of the price history data returned by the analytics API.
export interface PriceHistoryDto {
  product: {
    id: number;
    name: string;
    brandName: string | null;
    productGroupName: string;
    packageAmount: number | null;
    packageUnit: string | null;
  };
  currency: string | null;
  statistics: {
    latestCents: number | null;
    minimumCents: number | null;
    maximumCents: number | null;
    averageCents: number | null;
  };
  history: {
    receiptItemId: number;
    receiptId: number;
    purchaseDate: string;
    purchaseTime: string | null;
    merchantId: number;
    merchantName: string;
    currency: string;
    unitPriceCents: number | null;
    quantity: number;
  }[];
}

/**
 * Error class for handling price history related errors.
 */
export class PriceHistoryError extends Error {
  constructor(
    readonly code:
      "product_not_found" | "merchant_not_found" | "analytics_mixed_currencies",
  ) {
    super(code);
    this.name = "PriceHistoryError";
  }
}

/**
 * Loads the price history for a specific product, optionally filtered by merchant and date range.
 * @param db The database instance to use for the query.
 * @param query The query parameters specifying the product, merchant, and date range.
 * @returns The price history data transfer object containing product details, statistics, and historical observations.
 * @throws {PriceHistoryError} If the product or merchant is not found, or if mixed currencies are detected in the analytics.
 */
export function loadPriceHistory(
  db: Database,
  query: PriceHistoryQuery,
): PriceHistoryDto {
  return db.transaction((tx) => {
    const product = tx
      .select({
        id: products.id,
        name: products.name,
        brandName: brands.name,
        productGroupName: productGroups.name,
        packageAmount: products.packageAmount,
        packageUnit: products.packageUnit,
      })
      .from(products)
      .innerJoin(productGroups, eq(products.productGroupId, productGroups.id))
      .leftJoin(brands, eq(products.brandId, brands.id))
      .where(eq(products.id, query.productId))
      .get();
    if (!product) throw new PriceHistoryError("product_not_found");
    if (
      query.merchantId !== undefined &&
      !tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.id, query.merchantId))
        .get()
    )
      throw new PriceHistoryError("merchant_not_found");

    const history = tx
      .select({
        receiptItemId: receiptItems.id,
        receiptId: receipts.id,
        purchaseDate: receipts.purchaseDate,
        purchaseTime: receipts.purchaseTime,
        merchantId: merchants.id,
        merchantName: merchants.name,
        currency: receipts.currency,
        unitPriceCents: receiptItems.unitPriceCents,
        quantity: receiptItems.quantity,
      })
      .from(receiptItems)
      .innerJoin(receipts, eq(receiptItems.receiptId, receipts.id))
      .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
      .where(
        and(
          eq(receiptItems.productId, query.productId),
          query.from === undefined
            ? undefined
            : gte(receipts.purchaseDate, query.from),
          query.to === undefined
            ? undefined
            : lte(receipts.purchaseDate, query.to),
          query.merchantId === undefined
            ? undefined
            : eq(receipts.merchantId, query.merchantId),
        ),
      )
      // SQLite sorts absent times first. IDs and positions break ties deterministically.
      .orderBy(
        asc(receipts.purchaseDate),
        asc(receipts.purchaseTime),
        asc(receipts.id),
        asc(receiptItems.position),
        asc(receiptItems.id),
      )
      .all();

    const statistics: PriceHistoryDto["statistics"] = {
      latestCents: null,
      minimumCents: null,
      maximumCents: null,
      averageCents: null,
    };
    let currency: string | null = null;
    let count = 0;
    let total = 0;
    for (const row of history) {
      const price = row.unitPriceCents;
      // Zero and negative stored prices are valid; only missing prices are excluded.
      if (price === null) continue;
      if (currency !== null && currency !== row.currency)
        throw new PriceHistoryError("analytics_mixed_currencies");
      currency = row.currency;
      count++;
      total += price;
      statistics.latestCents = price;
      statistics.minimumCents =
        statistics.minimumCents === null
          ? price
          : Math.min(statistics.minimumCents, price);
      statistics.maximumCents =
        statistics.maximumCents === null
          ? price
          : Math.max(statistics.maximumCents, price);
    }
    if (count > 0)
      statistics.averageCents =
        Math.sign(total) * Math.round(Math.abs(total) / count) || 0;
    return { product, currency, statistics, history };
  });
}
