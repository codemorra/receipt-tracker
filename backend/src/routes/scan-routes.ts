import express, { type Express } from "express";
import { ZodError } from "zod";
import type { Database } from "../db/database.js";
import { errorType, type Logger } from "../logger.js";
import { loadExtractionReferenceData } from "../extraction/extraction-reference-data.js";
import {
  InvalidLlmResponseError,
  LlmRequestError,
  LlmUnavailableError,
} from "../extraction/extraction-errors.js";
import type {
  ReceiptExtractionDiagnostics,
  ReceiptExtractionProvider,
} from "../extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "../extraction/receipt-extraction.js";
import { createReviewDto } from "../review/review-dto.js";
import {
  ConfirmedEntityNotFoundError,
  DuplicateConfirmationRequiredError,
  saveReceipt,
  ScanArchiveNotFoundError,
} from "../review/receipt-persistence.js";
import {
  WorkerRequestError,
  WorkerUnavailableError,
} from "../worker/python-worker-client.js";
import {
  InvalidCornersError,
  InvalidRotationError,
  InvalidUploadError,
  isScanId,
  MAX_UPLOAD_BYTES,
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
 * @param provider The receipt extraction provider.
 * @param dataRoot The root directory for scan data.
 * @param logger The logger instance.
 */
export function registerScanRoutes(
  app: Express,
  scans: ScanSessionService,
  db: Database,
  provider: ReceiptExtractionProvider,
  dataRoot: string,
  logger: Logger,
) {
  // Scan creation endpoint
  app.post(
    "/api/scans",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
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
      const processingStarted = performance.now();
      let stage = "worker";
      let llmStarted: number | undefined;
      logger("info", "scan.process.start", {
        scanId: logScanId(request.params.scanId),
      });
      logger("info", "scan.worker.start", {
        scanId: logScanId(request.params.scanId),
      });
      const workerStarted = performance.now();
      try {
        const result = await scans.process(
          request.params.scanId,
          request.body?.corners,
          request.body?.rotation,
        );
        if (!result) {
          response.status(404).json({ error: "scan_not_found" });
          return;
        }
        const workerDurationMs = performance.now() - workerStarted;
        logger("info", "scan.ocr.complete", {
          scanId: result.scanId,
          ocrDurationMs: result.ocrDurationMs,
          workerDurationMs,
        });
        stage = "reference_data";
        const { categoryNames } = loadExtractionReferenceData(db);
        stage = "llm";
        let llm: ReceiptExtractionDiagnostics | undefined;
        logger("info", "scan.llm.start", { scanId: result.scanId });
        llmStarted = performance.now();
        const extracted = await provider.extractReceipt(
          {
            plainText: result.plainText,
            lines: result.lines,
            rows: result.rows,
            categoryNames,
          },
          (diagnostics) => {
            llm = diagnostics;
          },
        );
        const llmDurationMs = performance.now() - llmStarted;
        logger("info", "scan.llm.complete", {
          scanId: result.scanId,
          durationMs: llmDurationMs,
          provider: llm?.provider,
          model: llm?.model,
          inputTokens: llm?.inputTokens,
          outputTokens: llm?.outputTokens,
          totalTokens: llm?.totalTokens,
          ollamaTotalDurationMs: llm?.ollama?.totalDurationMs,
          loadDurationMs: llm?.ollama?.loadDurationMs,
          promptEvalCount: llm?.ollama?.promptEvalCount,
          promptEvalDurationMs: llm?.ollama?.promptEvalDurationMs,
          evalCount: llm?.ollama?.evalCount,
          evalDurationMs: llm?.ollama?.evalDurationMs,
        });
        stage = "review";
        const extraction = createReceiptExtractionSchema(
          categoryNames,
          result.lines.map((line) => line.index),
        ).parse(extracted);
        const review = createReviewDto(db, result, extraction);
        const totalDurationMs = performance.now() - processingStarted;
        logger("info", "scan.process.complete", {
          scanId: result.scanId,
          durationMs: totalDurationMs,
          ocrDurationMs: result.ocrDurationMs,
          llmDurationMs,
          workerDurationMs,
        });
        response.json({
          ...result,
          review,
          timings: {
            ocrDurationMs: result.ocrDurationMs,
            workerDurationMs,
            llmDurationMs,
            totalDurationMs,
            llm,
            ollama: llm?.ollama,
          },
        });
      } catch (error) {
        if (stage === "worker") {
          logger("error", "scan.worker.failed", {
            scanId: logScanId(request.params.scanId),
            durationMs: performance.now() - workerStarted,
            errorType: errorType(error),
          });
        }
        if (stage === "llm" && llmStarted !== undefined) {
          logger("error", "scan.llm.failed", {
            scanId: logScanId(request.params.scanId),
            durationMs: performance.now() - llmStarted,
            errorType: errorType(error),
            provider:
              error instanceof LlmUnavailableError ||
              error instanceof LlmRequestError
                ? error.provider
                : undefined,
            httpStatus:
              error instanceof LlmRequestError ? error.httpStatus : undefined,
          });
        }
        logger("error", "scan.process.failed", {
          scanId: logScanId(request.params.scanId),
          stage,
          durationMs: performance.now() - processingStarted,
          errorType: errorType(error),
        });
        if (error instanceof InvalidCornersError) {
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
