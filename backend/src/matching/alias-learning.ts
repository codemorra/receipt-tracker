import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/database.js";
import { merchantAliases, productAliases } from "../db/schema.js";
import { normalizeAlias } from "./alias-normalizer.js";

/**
 * Learns a new alias for a merchant if it doesn't already exist.
 * @param tx - The database transaction.
 * @param merchantId - The ID of the merchant.
 * @param rawName - The raw name of the merchant alias.
 * @param now - The current timestamp.
 */
export function learnMerchantAlias(
  tx: Transaction,
  merchantId: number,
  rawName: string | null,
  now: string,
) {
  if (!rawName) return;
  const normalizedAlias = normalizeAlias(rawName);
  if (!normalizedAlias) return;
  const existing = tx
    .select({ id: merchantAliases.id })
    .from(merchantAliases)
    .where(
      and(
        eq(merchantAliases.merchantId, merchantId),
        eq(merchantAliases.normalizedAlias, normalizedAlias),
      ),
    )
    .get();
  if (!existing)
    tx.insert(merchantAliases)
      .values({ merchantId, alias: rawName, normalizedAlias, createdAt: now })
      .run();
}

/**
 * Learns a new alias for a product if it doesn't already exist.
 * @param tx - The database transaction.
 * @param productId - The ID of the product.
 * @param rawName - The raw name of the product alias.
 * @param now - The current timestamp.
 */
export function learnProductAlias(
  tx: Transaction,
  productId: number | null,
  rawName: string,
  now: string,
) {
  if (productId === null) return;
  const normalizedAlias = normalizeAlias(rawName);
  if (!normalizedAlias) return;
  const existing = tx
    .select({ id: productAliases.id })
    .from(productAliases)
    .where(
      and(
        eq(productAliases.productId, productId),
        eq(productAliases.normalizedAlias, normalizedAlias),
      ),
    )
    .get();
  if (!existing)
    tx.insert(productAliases)
      .values({ productId, alias: rawName, normalizedAlias, createdAt: now })
      .run();
}
