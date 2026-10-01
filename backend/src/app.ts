import express, { type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import type { createDatabase } from "./db/database.js";
import { errorType, silentLogger, type Logger } from "./logger.js";
import type { ReceiptExtractionProvider } from "./extraction/receipt-extraction-provider.js";
import type { ScanSessionService } from "./scans/scan-session-service.js";
import { registerLookupRoutes } from "./routes/lookup-routes.js";
import { registerReceiptRoutes } from "./routes/receipt-routes.js";
import { registerScanRoutes } from "./routes/scan-routes.js";

/**
 * Creates and configures an Express application with routes for lookups, receipts, and scans.
 *
 * @param scans - The ScanSessionService instance used for handling scan sessions.
 * @param db - The database instance used for data persistence.
 * @param provider - The receipt extraction provider used for extracting receipt data.
 * @param dataRoot - The root directory for storing scan and receipt data.
 * @param logger - The logger instance for logging application events.
 * @returns The configured Express application.
 */
export function createApp(
  scans: ScanSessionService,
  db: ReturnType<typeof createDatabase>["db"],
  provider: ReceiptExtractionProvider,
  dataRoot = resolve(process.cwd(), "../data"),
  logger: Logger = silentLogger,
) {
  const app = express();

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  registerLookupRoutes(app, db);
  registerReceiptRoutes(app, db, dataRoot, logger);
  registerScanRoutes(app, scans, db, provider, dataRoot, logger);

  // Global error handler
  const handleError: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 413
    ) {
      response.status(413).json({ error: "upload_too_large" });
      return;
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 400
    ) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    logger("error", "request.failed", { errorType: errorType(error) });
    response.status(500).json({ error: "request_failed" });
  };
  app.use(handleError);

  return app;
}
