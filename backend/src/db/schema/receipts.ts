import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { products } from "./catalog.js";
import { merchants } from "./merchants.js";

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
