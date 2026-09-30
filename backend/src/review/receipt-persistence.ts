import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../db/database.js";
import {
  brands,
  categories,
  discounts,
  merchantAliases,
  merchants,
  productAliases,
  productGroups,
  products,
  receiptItems,
  receipts,
  warranties,
} from "../db/schema.js";
import { normalizeAlias } from "../matching/alias-normalizer.js";
import type { ScanSessionService } from "../scans/scan-session-service.js";
import { finalSaveSchema, type FinalSaveDto } from "./final-save.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class ConfirmedEntityNotFoundError extends Error {}
export class ScanArchiveNotFoundError extends Error {}

/**
 * Resolves a merchant by ID or creates a new one if it doesn't exist.
 * @param tx - The database transaction.
 * @param merchant - The merchant information from the final save DTO.
 * @param now - The current timestamp.
 * @returns The ID of the resolved or newly created merchant.
 * @throws ConfirmedEntityNotFoundError if the merchant ID is provided but not found.
 */
function resolveMerchant(
  tx: Transaction,
  merchant: FinalSaveDto["merchant"],
  now: string,
) {
  if (merchant.id !== null) {
    const existing = tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, merchant.id))
      .get();
    if (!existing) throw new ConfirmedEntityNotFoundError("Merchant not found");
    return existing.id;
  }
  return tx
    .insert(merchants)
    .values({ name: merchant.name, createdAt: now, updatedAt: now })
    .returning({ id: merchants.id })
    .get().id;
}

/**
 * Learns a new alias for a merchant if it doesn't already exist.
 * @param tx - The database transaction.
 * @param merchantId - The ID of the merchant.
 * @param rawName - The raw name of the merchant alias.
 * @param now - The current timestamp.
 */
function learnMerchantAlias(
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
 * Resolves a product by ID or creates a new one if it doesn't exist.
 * @param tx - The database transaction.
 * @param item - The item information from the final save DTO.
 * @param now - The current timestamp.
 * @returns The ID of the resolved or newly created product, or null if the line is not a product.
 * @throws ConfirmedEntityNotFoundError if the product ID is provided but not found.
 */
function resolveProduct(
  tx: Transaction,
  item: FinalSaveDto["items"][number],
  now: string,
) {
  if (item.lineType !== "product") return null;
  if (item.productId !== null) {
    const existing = tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, item.productId))
      .get();
    if (!existing) throw new ConfirmedEntityNotFoundError("Product not found");
    return existing.id;
  }

  // Ensure that the category exists or create a new one if it doesn't
  const categoryName = item.categoryName!;
  let category = tx
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, categoryName))
    .get();
  if (!category)
    category = tx
      .insert(categories)
      .values({ name: categoryName, createdAt: now, updatedAt: now })
      .returning({ id: categories.id })
      .get();

  // At this point, the category variable is guaranteed to have an ID
  let groupId: number;
  if (item.productGroupId !== null) {
    const group = tx
      .select({ id: productGroups.id, categoryId: productGroups.categoryId })
      .from(productGroups)
      .where(eq(productGroups.id, item.productGroupId))
      .get();
    if (!group || group.categoryId !== category.id)
      throw new ConfirmedEntityNotFoundError(
        "Product group not found in category",
      );
    groupId = group.id;
  } else {
    const group = tx
      .select({ id: productGroups.id })
      .from(productGroups)
      .where(
        and(
          eq(productGroups.categoryId, category.id),
          eq(productGroups.name, item.productGroupName!),
        ),
      )
      .get();
    groupId =
      group?.id ??
      tx
        .insert(productGroups)
        .values({
          categoryId: category.id,
          name: item.productGroupName!,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: productGroups.id })
        .get().id;
  }

  // At this point, the groupId variable is guaranteed to have an ID
  let brandId: number | null = null;
  if (item.brandId !== null) {
    const brand = tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, item.brandId))
      .get();
    if (!brand) throw new ConfirmedEntityNotFoundError("Brand not found");
    brandId = brand.id;
  } else if (item.brandName) {
    const brand = tx
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.name, item.brandName))
      .get();
    brandId =
      brand?.id ??
      tx
        .insert(brands)
        .values({ name: item.brandName, createdAt: now, updatedAt: now })
        .returning({ id: brands.id })
        .get().id;
  }

  return tx
    .insert(products)
    .values({
      productGroupId: groupId,
      brandId,
      name: item.productName!,
      packageAmount: item.packageAmount,
      packageUnit: item.packageUnit,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: products.id })
    .get().id;
}

/**
 * Learns a new alias for a product if it doesn't already exist.
 * @param tx - The database transaction.
 * @param productId - The ID of the product.
 * @param rawName - The raw name of the product alias.
 * @param now - The current timestamp.
 */
function learnProductAlias(
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
    receipt.items.forEach((item, position) => {
      const productId = resolveProduct(tx, item, now);
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

/**
 * Saves a receipt by first copying its image to the archive and then persisting it in the database.
 * @param db - The database instance.
 * @param scans - The scan session service.
 * @param dataRoot - The root directory for storing receipt images.
 * @param scanId - The ID of the scan session.
 * @param input - The raw input data for the receipt.
 * @returns The ID of the newly saved receipt.
 * @throws ScanArchiveNotFoundError if the scan archive cannot be found.
 */
export async function saveReceipt(
  db: Database,
  scans: ScanSessionService,
  dataRoot: string,
  scanId: string,
  input: unknown,
): Promise<number> {
  const receipt = finalSaveSchema.parse(input);
  const archive = await scans.archivePath(scanId);
  if (!archive) throw new ScanArchiveNotFoundError("Scan archive not found");
  const imagePath = `receipts/${randomUUID()}.webp`;
  const archiveDestination = join(dataRoot, imagePath);
  await mkdir(join(dataRoot, "receipts"), { recursive: true });
  let copied = false;
  try {
    await copyFile(archive, archiveDestination, constants.COPYFILE_EXCL);
    copied = true;
    return persistReceipt(db, receipt, imagePath);
  } catch (error) {
    if (
      !copied &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw error;
    }
    try {
      await rm(archiveDestination, { force: true });
    } catch (cleanupError) {
      console.error("Receipt archive cleanup failed", cleanupError);
    }
    throw error;
  }
}
