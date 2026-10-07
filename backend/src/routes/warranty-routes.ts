import type { Express } from "express";
import type { Database } from "../db/database.js";
import { errorType, type Logger } from "../logger.js";
import { listWarranties } from "../warranties/warranty-listing.js";
import { warrantyQuerySchema } from "../warranties/warranty-query.js";

/**
 * Registers warranty-related routes with the given Express application.
 * @param app The Express application to register the routes with.
 * @param db The database instance to use for warranty queries.
 * @param logger The logger instance for logging errors and other information.
 */
export function registerWarrantyRoutes(
  app: Express,
  db: Database,
  logger: Logger,
) {
  app.get("/api/warranties", (request, response) => {
    const parsed = warrantyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_warranty_query" });
      return;
    }
    try {
      response.json(listWarranties(db, parsed.data));
    } catch (error) {
      logger("error", "warranty.list.failed", { errorType: errorType(error) });
      response.status(500).json({ error: "warranty_list_failed" });
    }
  });
}
