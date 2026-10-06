import type { Express } from "express";
import type { Database } from "../db/database.js";
import { eq } from "drizzle-orm";
import { merchants } from "../db/schema.js";
import {
  listBrands,
  listCategories,
  listMerchants,
  listProductGroups,
  listProducts,
} from "../lookups/entity-lookups.js";

/**
 * Registers the lookup routes for categories, merchants, brands, product groups, and products.
 * @param app The Express application instance.
 * @param db The database instance.
 */
export function registerLookupRoutes(app: Express, db: Database) {
  // Categories endpoint
  app.get("/api/categories", (_request, response) => {
    response.json(listCategories(db));
  });

  // Merchants endpoint
  app.get("/api/merchants", (request, response) => {
    if (request.query.id !== undefined) {
      const value = request.query.id;
      const id =
        typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
      if (!Number.isSafeInteger(id) || id <= 0) {
        response.status(400).json({ error: "invalid_merchant_query" });
        return;
      }
      const merchant = db
        .select({ id: merchants.id, name: merchants.name })
        .from(merchants)
        .where(eq(merchants.id, id))
        .get();
      if (!merchant) {
        response.status(404).json({ error: "merchant_not_found" });
        return;
      }
      response.json([merchant]);
      return;
    }
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    response.json(listMerchants(db, query));
  });

  // Brands endpoint
  app.get("/api/brands", (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    response.json(listBrands(db, query));
  });

  // Product groups endpoint
  app.get("/api/product-groups", (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    response.json(listProductGroups(db, query));
  });

  // Products endpoint
  app.get("/api/products", (request, response) => {
    const query =
      typeof request.query.query === "string" ? request.query.query : "";
    response.json(listProducts(db, query));
  });
}
