import { and, eq } from "drizzle-orm";
import type { Transaction } from "../db/database.js";
import {
  brands,
  categories,
  merchants,
  productGroups,
  products,
} from "../db/schema.js";
import { ConfirmedEntityNotFoundError } from "./receipt-errors.js";
import type { FinalSaveDto } from "./final-save.js";

/**
 * Resolves a merchant by ID or creates a new one if it doesn't exist.
 * @param tx - The database transaction.
 * @param merchant - The merchant information from the final save DTO.
 * @param now - The current timestamp.
 * @returns The ID of the resolved or newly created merchant.
 * @throws ConfirmedEntityNotFoundError if the merchant ID is provided but not found.
 */
export function resolveMerchant(
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
 * Resolves a product by ID or creates a new one if it doesn't exist.
 * @param tx - The database transaction.
 * @param item - The item information from the final save DTO.
 * @param now - The current timestamp.
 * @returns The ID of the resolved or newly created product, or null if the line is not a product.
 * @throws ConfirmedEntityNotFoundError if the product ID is provided but not found.
 */
export function resolveProduct(
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
