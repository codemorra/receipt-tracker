import type { Express } from "express";
import type { Database } from "../db/database.js";
import { errorType, type Logger } from "../logger.js";
import {
  spendingQuerySchema,
  priceHistoryQuerySchema,
} from "../analytics/analytics-query.js";
import { loadSpending, SpendingError } from "../analytics/spending.js";
import {
  loadPriceHistory,
  PriceHistoryError,
} from "../analytics/price-history.js";

/**
 * Registers the analytics-related routes for the Express application.
 * @param app The Express application instance.
 * @param db The database instance.
 * @param logger The logger instance for logging errors and events.
 */
export function registerAnalyticsRoutes(
  app: Express,
  db: Database,
  logger: Logger,
) {
  // Register analytics-related routes for spending and price history.
  app.get("/api/analytics/spending", (request, response) => {
    const parsed = spendingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_analytics_query" });
      return;
    }
    try {
      response.json(loadSpending(db, parsed.data));
    } catch (error) {
      if (error instanceof SpendingError) {
        response
          .status(error.code === "merchant_not_found" ? 404 : 422)
          .json({ error: error.code });
        return;
      }
      logger("error", "analytics.spending.failed", {
        errorType: errorType(error),
      });
      response.status(500).json({ error: "analytics_spending_failed" });
    }
  });

  // Route for fetching the price history of a specific product.
  app.get("/api/analytics/price-history", (request, response) => {
    const parsed = priceHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_analytics_query" });
      return;
    }
    try {
      response.json(loadPriceHistory(db, parsed.data));
    } catch (error) {
      if (error instanceof PriceHistoryError) {
        response
          .status(error.code === "analytics_mixed_currencies" ? 422 : 404)
          .json({ error: error.code });
        return;
      }
      logger("error", "analytics.price_history.failed", {
        errorType: errorType(error),
      });
      response.status(500).json({ error: "analytics_price_history_failed" });
    }
  });
}
