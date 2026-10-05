import express, { type Express } from "express";
import { ZodError } from "zod";
import { saveReceipt } from "../receipts/receipt-save-service.js";
import type { Database } from "../db/database.js";
import { errorType, type Logger } from "../logger.js";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "../extraction/extraction-errors.js";
import type { ReceiptProcessingService } from "../scans/receipt-processing-service.js";
import { ProviderSettingsError } from "../settings/provider-settings.js";
import { SecretStorageError } from "../settings/secret-storage.js";
import {
  ConfirmedEntityNotFoundError,
  DuplicateConfirmationRequiredError,
  ScanArchiveNotFoundError,
} from "../receipts/receipt-errors.js";
import {
  WorkerRequestError,
  WorkerUnavailableError,
} from "../worker/python-worker-client.js";
import {
  InvalidCornersError,
  InvalidRotationError,
  InvalidUploadError,
  isScanId,
} from "../scans/scan-validation.js";
import type { ScanSessionService } from "../scans/scan-session-service.js";

/**
 * Logs the scan ID if it is valid.
 * @param value - The scan ID value to be logged.
 * @returns The scan ID if it is valid, otherwise undefined.
 */
function logScanId(value: string): string | undefined {
  return isScanId(value) ? value : undefined;
}

/**
 * Registers the scan routes for creating, previewing, and processing scans.
 * @param app The Express application instance.
 * @param scans The scan session service instance.
 * @param db The database instance.
 * @param processing The receipt processing service.
 * @param dataRoot The root directory for scan data.
 * @param logger The logger instance.
 */
export function registerScanRoutes(
  app: Express,
  scans: ScanSessionService,
  db: Database,
  processing: ReceiptProcessingService,
  dataRoot: string,
  logger: Logger,
) {
  // Scan creation endpoint
  app.post(
    "/api/scans",
    express.raw({ type: () => true, limit: Number.POSITIVE_INFINITY }),
    async (request, response) => {
      const started = performance.now();
      logger("info", "scan.create.start");
      try {
        const scan = await scans.create(
          request.headers["content-type"],
          request.body,
        );
        logger("info", "scan.create.complete", {
          scanId: scan.scanId,
          durationMs: performance.now() - started,
        });
        response.status(201).json(scan);
      } catch (error) {
        logger("error", "scan.create.failed", {
          durationMs: performance.now() - started,
          errorType: errorType(error),
        });
        if (error instanceof InvalidUploadError) {
          response
            .status(error.status)
            .json({ error: "invalid_upload", message: error.message });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "invalid_image" });
        } else {
          response.status(500).json({ error: "scan_failed" });
        }
      }
    },
  );

  // Scan preview endpoint
  app.get("/api/scans/:scanId/preview", async (request, response) => {
    try {
      const previewPath = await scans.previewPath(request.params.scanId);
      if (!previewPath) {
        response.status(404).json({ error: "scan_not_found" });
        return;
      }
      response.type("image/webp").sendFile(previewPath);
    } catch (error) {
      logger("error", "scan.preview.failed", {
        scanId: logScanId(request.params.scanId),
        errorType: errorType(error),
      });
      response.status(500).json({ error: "scan_failed" });
    }
  });

  // Scan processing endpoint
  app.post(
    "/api/scans/:scanId/process",
    express.json({ limit: "16kb" }),
    async (request, response) => {
      try {
        const result = await processing.process(request.params.scanId, {
          corners: request.body?.corners,
          rotation: request.body?.rotation,
          provider: request.body?.provider,
        });
        if (!result) {
          response.status(404).json({ error: "scan_not_found" });
          return;
        }
        response.json(result);
      } catch (error) {
        if (error instanceof ProviderSettingsError) {
          response
            .status(error.code === "invalid_provider" ? 400 : 409)
            .json({ error: error.code });
        } else if (error instanceof SecretStorageError) {
          response.status(503).json({ error: error.code });
        } else if (error instanceof InvalidCornersError) {
          response.status(400).json({ error: "invalid_corners" });
        } else if (error instanceof InvalidRotationError) {
          response.status(400).json({ error: "invalid_rotation" });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "processing_failed" });
        } else if (error instanceof LlmUnavailableError) {
          response.status(503).json({
            error:
              error.provider === "ollama"
                ? "ollama_unavailable"
                : "llm_unavailable",
          });
        } else if (
          error instanceof LlmRequestError &&
          [401, 403].includes(error.httpStatus ?? 0)
        ) {
          response
            .status(502)
            .json({ error: "provider_authentication_failed" });
        } else if (error instanceof LlmRequestError) {
          response.status(502).json({
            error: error.provider === "ollama" ? "ollama_failed" : "llm_failed",
          });
        } else if (error instanceof InvalidLlmResponseError) {
          response.status(502).json({ error: "invalid_llm_response" });
        } else if (error instanceof ZodError) {
          response.status(502).json({ error: "invalid_extraction" });
        } else {
          response.status(500).json({ error: "scan_failed" });
        }
      }
    },
  );

  // Receipt confirmation endpoint
  app.post(
    "/api/scans/:scanId/confirm",
    express.json({ limit: "256kb" }),
    async (request, response) => {
      try {
        const receiptId = await saveReceipt(
          db,
          scans,
          dataRoot,
          request.params.scanId,
          request.body,
          logger,
        );
        logger("info", "receipt.save.complete", {
          scanId: logScanId(request.params.scanId),
          receiptId,
        });
        response.status(201).json({ receiptId });
      } catch (error) {
        logger("error", "receipt.save.failed", {
          scanId: logScanId(request.params.scanId),
          errorType: errorType(error),
        });
        if (error instanceof ZodError) {
          response.status(400).json({ error: "invalid_final_save" });
        } else if (error instanceof ScanArchiveNotFoundError) {
          response.status(404).json({ error: "scan_archive_not_found" });
        } else if (error instanceof ConfirmedEntityNotFoundError) {
          response.status(409).json({ error: "confirmed_entity_not_found" });
        } else if (error instanceof DuplicateConfirmationRequiredError) {
          response.status(409).json({
            error: "duplicate_confirmation_required",
            candidates: error.candidates,
          });
        } else {
          response.status(500).json({ error: "receipt_save_failed" });
        }
      }
    },
  );

  // Scan cancellation endpoint
  app.delete("/api/scans/:scanId", async (request, response) => {
    try {
      if (!(await scans.cancel(request.params.scanId))) {
        response.status(404).json({ error: "scan_not_found" });
        return;
      }
      logger("info", "scan.cancel.complete", {
        scanId: logScanId(request.params.scanId),
      });
      response.status(204).end();
    } catch (error) {
      logger("error", "scan.cancel.failed", {
        scanId: logScanId(request.params.scanId),
        errorType: errorType(error),
      });
      response.status(500).json({ error: "scan_cancel_failed" });
    }
  });

  // Scan archive endpoint
  app.get("/api/scans/:scanId/archive", async (request, response) => {
    try {
      const archivePath = await scans.archivePath(request.params.scanId);
      if (!archivePath) {
        response.status(404).json({ error: "scan_not_found" });
        return;
      }
      response.type("image/webp").sendFile(archivePath);
    } catch (error) {
      logger("error", "scan.archive.failed", {
        scanId: logScanId(request.params.scanId),
        errorType: errorType(error),
      });
      response.status(500).json({ error: "scan_failed" });
    }
  });
}
