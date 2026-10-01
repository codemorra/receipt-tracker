import express, { type ErrorRequestHandler } from "express";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import type { createDatabase } from "./db/database.js";
import { errorType, silentLogger, type Logger } from "./logger.js";
import { receipts } from "./db/schema.js";
import { loadExtractionReferenceData } from "./extraction/extraction-reference-data.js";
import {
  InvalidLlmResponseError,
  OllamaRequestError,
  OllamaUnavailableError,
} from "./extraction/ollama-provider.js";
import type {
  OllamaDiagnostics,
  ReceiptExtractionProvider,
} from "./extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "./extraction/receipt-extraction.js";
import { createReviewDto } from "./review/review-dto.js";
import { loadReceiptDetail } from "./review/receipt-detail.js";
import {
  ConfirmedEntityNotFoundError,
  DuplicateConfirmationRequiredError,
  saveReceipt,
  ScanArchiveNotFoundError,
} from "./review/receipt-persistence.js";
import {
  listBrands,
  listCategories,
  listMerchants,
  listProductGroups,
  listProducts,
} from "./review/review-lookups.js";
import {
  WorkerRequestError,
  WorkerUnavailableError,
} from "./worker/python-worker-client.js";
import {
  InvalidCornersError,
  InvalidUploadError,
  isScanId,
  MAX_UPLOAD_BYTES,
  ScanSessionService,
} from "./scans/scan-session-service.js";

/**
 * Logs the scan ID if it is valid.
 * @param value - The scan ID value to be logged.
 * @returns The scan ID if it is valid, otherwise undefined.
 */
function logScanId(value: string): string | undefined {
  return isScanId(value) ? value : undefined;
}

/**
 * Creates and configures an Express application.
 *
 * @param scans - The ScanSessionService instance used for handling scan sessions.
 * @param db - The database instance used for data persistence.
 * @param provider - The receipt extraction provider used for extracting receipt data.
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
  const receiptsRoot = resolve(dataRoot, "receipts");

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  // Categories endpoint
  app.get("/api/categories", (_request, response) => {
    response.json(listCategories(db));
  });

  // Merchants endpoint
  app.get("/api/merchants", (request, response) => {
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

  // Receipts endpoint
  app.get("/api/receipts/:receiptId", (request, response) => {
    const receiptId = Number(request.params.receiptId);
    if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
      response.status(404).json({ error: "receipt_not_found" });
      return;
    }
    try {
      const detail = loadReceiptDetail(db, receiptId);
      if (!detail) {
        response.status(404).json({ error: "receipt_not_found" });
        return;
      }
      response.json(detail);
    } catch (error) {
      logger("error", "receipt.detail.failed", {
        receiptId,
        errorType: errorType(error),
      });
      response.status(500).json({ error: "receipt_detail_failed" });
    }
  });

  // Receipt image endpoint
  app.get("/api/receipts/:receiptId/image", (request, response) => {
    const receiptId = Number(request.params.receiptId);
    if (!Number.isSafeInteger(receiptId) || receiptId <= 0) {
      response.status(404).json({ error: "receipt_not_found" });
      return;
    }

    const receipt = db
      .select({ imagePath: receipts.imagePath })
      .from(receipts)
      .where(eq(receipts.id, receiptId))
      .get();
    if (!receipt || isAbsolute(receipt.imagePath)) {
      response.status(404).json({ error: "receipt_not_found" });
      return;
    }

    const imagePath = relative(
      receiptsRoot,
      resolve(dataRoot, receipt.imagePath),
    );
    if (
      !imagePath ||
      imagePath === ".." ||
      imagePath.startsWith(`..${sep}`) ||
      isAbsolute(imagePath)
    ) {
      response.status(404).json({ error: "receipt_not_found" });
      return;
    }

    response
      .type("image/webp")
      .sendFile(imagePath, { root: receiptsRoot }, (error) => {
        if (!error || response.headersSent) return;
        if ("status" in error && error.status === 404) {
          response.status(404).json({ error: "receipt_image_not_found" });
          return;
        }
        logger("error", "receipt.image.failed", {
          receiptId,
          errorType: errorType(error),
        });
        response.status(500).json({ error: "receipt_image_failed" });
      });
  });

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
        let ollama: OllamaDiagnostics | undefined;
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
            ollama = diagnostics;
          },
        );
        const llmDurationMs = performance.now() - llmStarted;
        logger("info", "scan.llm.complete", {
          scanId: result.scanId,
          durationMs: llmDurationMs,
          model: ollama?.model,
          ollamaTotalDurationMs: ollama?.totalDurationMs,
          loadDurationMs: ollama?.loadDurationMs,
          promptEvalCount: ollama?.promptEvalCount,
          promptEvalDurationMs: ollama?.promptEvalDurationMs,
          evalCount: ollama?.evalCount,
          evalDurationMs: ollama?.evalDurationMs,
        });
        stage = "review";
        const extraction =
          createReceiptExtractionSchema(categoryNames).parse(extracted);
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
            ollama,
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
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "processing_failed" });
        } else if (error instanceof OllamaUnavailableError) {
          response.status(503).json({ error: "ollama_unavailable" });
        } else if (error instanceof OllamaRequestError) {
          response.status(502).json({ error: "ollama_failed" });
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

  // Scan OCR image endpoint
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
