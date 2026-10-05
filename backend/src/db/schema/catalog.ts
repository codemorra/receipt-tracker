import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
