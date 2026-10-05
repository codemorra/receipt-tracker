import express, { type ErrorRequestHandler } from "express";
import { resolve } from "node:path";
import type { Database } from "./db/database.js";
import { errorType, silentLogger, type Logger } from "./logger.js";
import type { ProviderResolver } from "./extraction/provider-resolver.js";
import { ReceiptProcessingService } from "./scans/receipt-processing-service.js";
import { ProviderSettingsService } from "./settings/provider-settings-service.js";
import { registerSettingsRoutes } from "./routes/settings-routes.js";
import type { ScanSessionService } from "./scans/scan-session-service.js";
import { registerLookupRoutes } from "./routes/lookup-routes.js";
import { registerReceiptRoutes } from "./routes/receipt-routes.js";
import { registerScanRoutes } from "./routes/scan-routes.js";

/**
 * Creates and configures an Express application with routes for lookups, receipts, and scans.
 *
 * @param scans - The ScanSessionService instance used for handling scan sessions.
 * @param db - The database instance used for data persistence.
 * @param resolveProvider - Resolves the provider for each process request.
 * @param dataRoot - The root directory for storing scan and receipt data.
 * @param logger - The logger instance for logging application events.
 * @returns The configured Express application.
 */
export function createApp(
  scans: ScanSessionService,
  db: Database,
  resolveProvider: ProviderResolver,
  dataRoot = resolve(process.cwd(), "../data"),
  logger: Logger = silentLogger,
  settings = new ProviderSettingsService(db),
) {
  const app = express();

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  registerLookupRoutes(app, db);
  registerReceiptRoutes(app, db, dataRoot, logger);
  const processing = new ReceiptProcessingService(
    scans,
    db,
    resolveProvider,
    logger,
  );
  registerScanRoutes(app, scans, db, processing, dataRoot, logger);
  registerSettingsRoutes(app, settings, logger);

  // Global error handler
  const handleError: ErrorRequestHandler = (error, request, response, next) => {
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
      response.status(413).json({
        error: request.path.startsWith("/api/settings/ai")
          ? "settings_payload_too_large"
          : "upload_too_large",
      });
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
