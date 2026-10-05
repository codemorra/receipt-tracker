import { relations, sql } from "drizzle-orm";
import {
  index,
  check,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Database schema definitions for the receipt tracker application.
export const aiProviderSettings = sqliteTable(
  "ai_provider_settings",
  {
    provider: text("provider", {
      enum: ["ollama", "mistral", "openai"],
    }).primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    model: text("model").notNull().default(""),
    ollamaBaseUrl: text("ollama_base_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
  },
  (table) => [
    check(
      "ai_provider_id",
      sql`${table.provider} IN ('ollama', 'mistral', 'openai')`,
    ),
    check("ai_provider_enabled", sql`${table.enabled} IN (0, 1)`),
    check(
      "ai_provider_url",
      sql`${table.provider} = 'ollama' OR ${table.ollamaBaseUrl} IS NULL`,
    ),
    check(
      "ai_provider_secret",
      sql`${table.provider} != 'ollama' OR ${table.apiKeyEncrypted} IS NULL`,
    ),
  ],
);

// Receipt processing settings table definition.
export const receiptProcessingSettings = sqliteTable(
  "receipt_processing_settings",
  {
    id: integer("id").primaryKey(),
    defaultProvider: text("default_provider", {
      enum: ["ollama", "mistral", "openai"],
    }).references(() => aiProviderSettings.provider),
  },
  (table) => [check("receipt_processing_singleton", sql`${table.id} = 1`)],
);

// Categories table definition.
export const categories = sqliteTable("category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Product groups table definition.
export const productGroups = sqliteTable("product_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categories.id),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Brands table definition.
export const brands = sqliteTable("brand", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Products table definition.
export const products = sqliteTable("product", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productGroupId: integer("product_group_id")
    .notNull()
    .references(() => productGroups.id),
  brandId: integer("brand_id").references(() => brands.id),
  name: text("name").notNull(),
  packageAmount: real("package_amount"),
  packageUnit: text("package_unit"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Product aliases table definition.
export const productAliases = sqliteTable(
  "product_alias",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("product_alias_normalized_alias_idx").on(table.normalizedAlias),
  ],
);

// Merchants table definition.
export const merchants = sqliteTable("merchant", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Merchant aliases table definition.
export const merchantAliases = sqliteTable(
  "merchant_alias",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("merchant_alias_normalized_alias_idx").on(table.normalizedAlias),
  ],
);

// Receipts table definition.
export const receipts = sqliteTable(
  "receipt",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    merchantRawName: text("merchant_raw_name"),
    purchaseDate: text("purchase_date").notNull(),
    purchaseTime: text("purchase_time"),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    imagePath: text("image_path").notNull(),
    rawOcrText: text("raw_ocr_text"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("receipt_duplicate_candidate_idx").on(
      table.merchantId,
      table.purchaseDate,
      table.totalCents,
    ),
  ],
);

// Receipt items table definition.
export const receiptItems = sqliteTable("receipt_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.id),
  productId: integer("product_id").references(() => products.id),
  position: integer("position").notNull(),
  rawName: text("raw_name").notNull(),
  quantity: real("quantity").notNull(),
  unit: text("unit"),
  unitPriceCents: integer("unit_price_cents"),
  totalPriceCents: integer("total_price_cents").notNull(),
  lineType: text("line_type").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Discounts table definition.
export const discounts = sqliteTable("discount", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id")
    .notNull()
    .references(() => receipts.id),
  receiptItemId: integer("receipt_item_id").references(() => receiptItems.id),
  description: text("description"),
  amountCents: integer("amount_cents").notNull(),
  createdAt: text("created_at").notNull(),
});

// Warranties table definition.
export const warranties = sqliteTable("warranty", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptItemId: integer("receipt_item_id")
    .notNull()
    .references(() => receiptItems.id),
  type: text("type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
