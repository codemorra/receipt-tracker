import express, { type ErrorRequestHandler } from "express";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import type { createDatabase } from "./db/database.js";
import { receipts } from "./db/schema.js";
import { loadExtractionReferenceData } from "./extraction/extraction-reference-data.js";
import {
  InvalidLlmResponseError,
  OllamaRequestError,
  OllamaUnavailableError,
} from "./extraction/ollama-provider.js";
import type { ReceiptExtractionProvider } from "./extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "./extraction/receipt-extraction.js";
import { createReviewDto } from "./review/review-dto.js";
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
  MAX_UPLOAD_BYTES,
  ScanSessionService,
} from "./scans/scan-session-service.js";

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
        console.error("Receipt image failed", error);
        response.status(500).json({ error: "receipt_image_failed" });
      });
  });

  // Scan creation endpoint
  app.post(
    "/api/scans",
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    async (request, response) => {
      try {
        const scan = await scans.create(
          request.headers["content-type"],
          request.body,
        );
        response.status(201).json(scan);
      } catch (error) {
        if (error instanceof InvalidUploadError) {
          response
            .status(error.status)
            .json({ error: "invalid_upload", message: error.message });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "invalid_image" });
        } else {
          console.error("Scan creation failed", error);
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
      console.error("Scan preview failed", error);
      response.status(500).json({ error: "scan_failed" });
    }
  });

  // Scan processing endpoint
  app.post(
    "/api/scans/:scanId/process",
    express.json({ limit: "16kb" }),
    async (request, response) => {
      try {
        const result = await scans.process(
          request.params.scanId,
          request.body?.corners,
        );
        if (!result) {
          response.status(404).json({ error: "scan_not_found" });
          return;
        }
        const { categoryNames } = loadExtractionReferenceData(db);
        const extracted = await provider.extractReceipt({
          plainText: result.plainText,
          lines: result.lines,
          categoryNames,
        });
        const extraction =
          createReceiptExtractionSchema(categoryNames).parse(extracted);
        const review = createReviewDto(db, result, extraction);
        response.json({ ...result, review });
      } catch (error) {
        if (error instanceof InvalidCornersError) {
          response.status(400).json({ error: "invalid_corners" });
        } else if (error instanceof WorkerUnavailableError) {
          response.status(503).json({ error: "worker_unavailable" });
        } else if (error instanceof WorkerRequestError) {
          response.status(422).json({ error: "processing_failed" });
        } else if (error instanceof OllamaUnavailableError) {
          console.error("Ollama unavailable", error);
          response.status(503).json({ error: "ollama_unavailable" });
        } else if (error instanceof OllamaRequestError) {
          console.error("Ollama request failed", error);
          response.status(502).json({ error: "ollama_failed" });
        } else if (error instanceof InvalidLlmResponseError) {
          console.error("Invalid Ollama response", error);
          response.status(502).json({ error: "invalid_llm_response" });
        } else if (error instanceof ZodError) {
          console.error("Invalid receipt extraction", error);
          response.status(502).json({ error: "invalid_extraction" });
        } else {
          console.error("Scan processing failed", error);
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
        );
        response.status(201).json({ receiptId });
      } catch (error) {
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
          console.error("Receipt confirmation failed", error);
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
      response.status(204).end();
    } catch (error) {
      console.error("Scan cancellation failed", error);
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
      console.error("Scan archive failed", error);
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
    console.error("Request failed", error);
    response.status(500).json({ error: "request_failed" });
  };
  app.use(handleError);

  return app;
}
