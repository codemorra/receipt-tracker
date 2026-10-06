import { asc, eq, or, sql } from "drizzle-orm";
import { normalizeAlias } from "../matching/alias-normalizer.js";
import { productNameOrAliasMatches } from "./product-search.js";
import type { Database } from "../db/database.js";
import {
  brands,
  categories,
  merchants,
  productGroups,
  products,
} from "../db/schema.js";

const MAX_RESULTS = 50;

/**
 * Checks if the query string matches any of the provided values, ignoring case and leading/trailing whitespace.
 * @param query The query string to match against.
 * @param values The values to check for a match.
 * @returns True if the query matches any of the values, false otherwise.
 */
function matchesQuery(query: string, ...values: (string | null)[]): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return values.some((value) =>
    value?.toLocaleLowerCase().includes(normalizedQuery),
  );
}

/**
 * Lists all categories in the database, ordered by name.
 * @param db The database instance.
 * @returns An array of category objects containing the ID and name.
 */
export function listCategories(db: Database) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .orderBy(asc(categories.name))
    .all();
}

/**
 * Lists all merchants in the database, ordered by name, and filters them based on the query string.
 * @param db The database instance.
 * @param query The query string to filter merchants by name.
 * @returns An array of merchant objects containing the ID and name, limited to a maximum number of results.
 */
export function listMerchants(db: Database, query: string) {
  return db
    .select({ id: merchants.id, name: merchants.name })
    .from(merchants)
    .orderBy(asc(merchants.name))
    .all()
    .filter((merchant) => matchesQuery(query, merchant.name))
    .slice(0, MAX_RESULTS);
}

/**
 * Lists all brands in the database, ordered by name, and filters them based on the query string.
 * @param db The database instance.
 * @param query The query string to filter brands by name.
 * @returns An array of brand objects containing the ID and name, limited to a maximum number of results.
 */
export function listBrands(db: Database, query: string) {
  return db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .orderBy(asc(brands.name))
    .all()
    .filter((brand) => matchesQuery(query, brand.name))
    .slice(0, MAX_RESULTS);
}

/**
 * Lists all product groups in the database, ordered by name, and filters them based on the query string.
 * @param db The database instance.
 * @param query The query string to filter product groups by name or category name.
 * @returns An array of product group objects containing the ID, name, category ID, and category name, limited to a maximum number of results.
 */
export function listProductGroups(db: Database, query: string) {
  return db
    .select({
      id: productGroups.id,
      name: productGroups.name,
      categoryId: categories.id,
      categoryName: categories.name,
    })
    .from(productGroups)
    .innerJoin(categories, eq(productGroups.categoryId, categories.id))
    .orderBy(asc(productGroups.name))
    .all()
    .filter((group) => matchesQuery(query, group.name, group.categoryName))
    .slice(0, MAX_RESULTS);
}

/**
 * Searches products by normalized name, aliases, product group, or brand in SQL.
 * @param db The database instance.
 * @param query The query string to filter products by name, product group name, or brand name.
 * @returns An array of product objects containing the ID, name, product group ID and name, category ID and name, brand ID and name, package amount, and package unit, limited to a maximum number of results.
 */
export function listProducts(db: Database, query: string) {
  const normalized = normalizeAlias(query);
  const predicate = !query.trim()
    ? undefined
    : !normalized
      ? sql`0`
      : or(
          productNameOrAliasMatches(normalized),
          sql`instr(receipt_search_normalize(${productGroups.name}), ${normalized}) > 0`,
          sql`instr(receipt_search_normalize(coalesce(${brands.name}, '')), ${normalized}) > 0`,
        );
  return db
    .select({
      id: products.id,
      name: products.name,
      productGroupId: productGroups.id,
      productGroupName: productGroups.name,
      categoryId: categories.id,
      categoryName: categories.name,
      brandId: brands.id,
      brandName: brands.name,
      packageAmount: products.packageAmount,
      packageUnit: products.packageUnit,
    })
    .from(products)
    .innerJoin(productGroups, eq(products.productGroupId, productGroups.id))
    .innerJoin(categories, eq(productGroups.categoryId, categories.id))
    .leftJoin(brands, eq(products.brandId, brands.id))
    .where(predicate)
    .orderBy(asc(products.name), asc(products.id))
    .limit(MAX_RESULTS)
    .all();
}
