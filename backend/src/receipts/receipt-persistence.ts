import type { Database } from "../db/database.js";
import { discounts, receiptItems, receipts, warranties } from "../db/schema.js";
import {
  learnMerchantAlias,
  learnProductAlias,
} from "../matching/alias-learning.js";
import { findDuplicateCandidates } from "./duplicate-detection.js";
import { DuplicateConfirmationRequiredError } from "./receipt-errors.js";
import { resolveMerchant, resolveProduct } from "./receipt-associations.js";
import type { FinalSaveDto } from "./final-save.js";

/**
 * Persists a receipt along with its items, warranties, and discounts.
 * @param db - The database instance.
 * @param receipt - The final save DTO containing receipt information.
 * @param imagePath - The path to the receipt image.
 * @returns The ID of the newly persisted receipt.
 */
export function persistReceipt(
  db: Database,
  receipt: FinalSaveDto,
  imagePath: string,
): number {
  return db.transaction((tx) => {
    const candidates = findDuplicateCandidates(db, {
      merchantId: receipt.merchant.id,
      purchaseDate: receipt.purchaseDate,
      purchaseTime: receipt.purchaseTime,
      totalCents: receipt.totalCents,
    });
    if (candidates.length > 0 && receipt.duplicateOverride !== true) {
      throw new DuplicateConfirmationRequiredError(candidates);
    }
    const now = new Date().toISOString();
    const merchantId = resolveMerchant(tx, receipt.merchant, now);
    learnMerchantAlias(tx, merchantId, receipt.merchant.rawName, now);
    const receiptId = tx
      .insert(receipts)
      .values({
        merchantId,
        merchantRawName: receipt.merchant.rawName,
        purchaseDate: receipt.purchaseDate,
        purchaseTime: receipt.purchaseTime,
        totalCents: receipt.totalCents,
        currency: receipt.currency,
        imagePath,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: receipts.id })
      .get().id;
    const itemIds: number[] = [];
    const newProductIds = new Map<string, number>();
    receipt.items.forEach((item, position) => {
      const productId = resolveProduct(tx, item, now, newProductIds);
      learnProductAlias(tx, productId, item.rawName, now);
      const itemId = tx
        .insert(receiptItems)
        .values({
          receiptId,
          productId,
          position,
          rawName: item.rawName,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
          lineType: item.lineType,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: receiptItems.id })
        .get().id;
      itemIds.push(itemId);
      item.warranties.forEach((warranty) => {
        tx.insert(warranties)
          .values({
            receiptItemId: itemId,
            ...warranty,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
    });
    receipt.discounts.forEach((discount) => {
      tx.insert(discounts)
        .values({
          receiptId,
          receiptItemId:
            discount.appliesToItemIndex === null
              ? null
              : itemIds[discount.appliesToItemIndex],
          description: discount.description,
          amountCents: discount.amountCents,
          createdAt: now,
        })
        .run();
    });
    return receiptId;
  });
}
