import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
