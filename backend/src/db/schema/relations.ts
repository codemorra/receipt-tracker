import { relations } from "drizzle-orm";
import {
  brands,
  categories,
  productAliases,
  productGroups,
  products,
} from "./catalog.js";
import { merchantAliases, merchants } from "./merchants.js";
import { discounts, receiptItems, receipts, warranties } from "./receipts.js";

// Category relations definition.
export const categoryRelations = relations(categories, ({ many }) => ({
  productGroups: many(productGroups),
}));

// Product group relations definition.
export const productGroupRelations = relations(
  productGroups,
  ({ one, many }) => ({
    category: one(categories, {
      fields: [productGroups.categoryId],
      references: [categories.id],
    }),
    products: many(products),
  }),
);

// Brand relations definition.
export const brandRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

// Product relations definition.
export const productRelations = relations(products, ({ one, many }) => ({
  productGroup: one(productGroups, {
    fields: [products.productGroupId],
    references: [productGroups.id],
  }),
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  aliases: many(productAliases),
  receiptItems: many(receiptItems),
}));

// Product alias relations definition.
export const productAliasRelations = relations(productAliases, ({ one }) => ({
  product: one(products, {
    fields: [productAliases.productId],
    references: [products.id],
  }),
}));

// Merchant relations definition.
export const merchantRelations = relations(merchants, ({ many }) => ({
  aliases: many(merchantAliases),
  receipts: many(receipts),
}));

// Merchant alias relations definition.
export const merchantAliasRelations = relations(merchantAliases, ({ one }) => ({
  merchant: one(merchants, {
    fields: [merchantAliases.merchantId],
    references: [merchants.id],
  }),
}));

// Receipt relations definition.
export const receiptRelations = relations(receipts, ({ one, many }) => ({
  merchant: one(merchants, {
    fields: [receipts.merchantId],
    references: [merchants.id],
  }),
  items: many(receiptItems),
  discounts: many(discounts),
}));

// Receipt item relations definition.
export const receiptItemRelations = relations(
  receiptItems,
  ({ one, many }) => ({
    receipt: one(receipts, {
      fields: [receiptItems.receiptId],
      references: [receipts.id],
    }),
    product: one(products, {
      fields: [receiptItems.productId],
      references: [products.id],
    }),
    discounts: many(discounts),
    warranties: many(warranties),
  }),
);

// Discount relations definition.
export const discountRelations = relations(discounts, ({ one }) => ({
  receipt: one(receipts, {
    fields: [discounts.receiptId],
    references: [receipts.id],
  }),
  receiptItem: one(receiptItems, {
    fields: [discounts.receiptItemId],
    references: [receiptItems.id],
  }),
}));

// Warranty relations definition.
export const warrantyRelations = relations(warranties, ({ one }) => ({
  receiptItem: one(receiptItems, {
    fields: [warranties.receiptItemId],
    references: [receiptItems.id],
  }),
}));
