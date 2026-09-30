import { asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../db/database.js";
import {
  brands,
  categories,
  discounts,
  merchants,
  productGroups,
  products,
  receiptItems,
  receipts,
  warranties,
} from "../db/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Service for loading detailed information about a receipt, including its items, associated products, discounts, and warranties.
 * @param db - The database instance to use for queries.
 * @param receiptId - The ID of the receipt to load details for.
 * @returns An object containing detailed information about the receipt, or null if not found.
 */
export function loadReceiptDetail(db: Database, receiptId: number) {
  const receipt = db
    .select({
      id: receipts.id,
      merchantId: merchants.id,
      merchantName: merchants.name,
      merchantRawName: receipts.merchantRawName,
      purchaseDate: receipts.purchaseDate,
      purchaseTime: receipts.purchaseTime,
      totalCents: receipts.totalCents,
      currency: receipts.currency,
    })
    .from(receipts)
    .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
    .where(eq(receipts.id, receiptId))
    .get();
  if (!receipt) return null;

  const items = db
    .select({
      id: receiptItems.id,
      position: receiptItems.position,
      rawName: receiptItems.rawName,
      quantity: receiptItems.quantity,
      unit: receiptItems.unit,
      unitPriceCents: receiptItems.unitPriceCents,
      totalPriceCents: receiptItems.totalPriceCents,
      lineType: receiptItems.lineType,
      productId: products.id,
      productName: products.name,
      productGroupName: productGroups.name,
      categoryName: categories.name,
      brandName: brands.name,
      packageAmount: products.packageAmount,
      packageUnit: products.packageUnit,
    })
    .from(receiptItems)
    .leftJoin(products, eq(receiptItems.productId, products.id))
    .leftJoin(productGroups, eq(products.productGroupId, productGroups.id))
    .leftJoin(categories, eq(productGroups.categoryId, categories.id))
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(eq(receiptItems.receiptId, receiptId))
    .orderBy(asc(receiptItems.position))
    .all();

  const savedDiscounts = db
    .select({
      id: discounts.id,
      receiptItemId: discounts.receiptItemId,
      description: discounts.description,
      amountCents: discounts.amountCents,
    })
    .from(discounts)
    .where(eq(discounts.receiptId, receiptId))
    .orderBy(asc(discounts.id))
    .all();
  const savedWarranties =
    items.length === 0
      ? []
      : db
          .select({
            id: warranties.id,
            receiptItemId: warranties.receiptItemId,
            type: warranties.type,
            startDate: warranties.startDate,
            endDate: warranties.endDate,
            notes: warranties.notes,
          })
          .from(warranties)
          .where(
            inArray(
              warranties.receiptItemId,
              items.map((item) => item.id),
            ),
          )
          .orderBy(asc(warranties.id))
          .all();

  return {
    ...receipt,
    imageUrl: `/api/receipts/${receipt.id}/image`,
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      rawName: item.rawName,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
      lineType: item.lineType,
      product:
        item.productId === null
          ? null
          : {
              id: item.productId,
              name: item.productName,
              brandName: item.brandName,
              productGroupName: item.productGroupName,
              categoryName: item.categoryName,
              packageAmount: item.packageAmount,
              packageUnit: item.packageUnit,
            },
      warranties: savedWarranties.filter(
        (warranty) => warranty.receiptItemId === item.id,
      ),
    })),
    discounts: savedDiscounts,
  };
}
