import type { Express } from "express";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { eq } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { receipts } from "../db/schema.js";
import { errorType, type Logger } from "../logger.js";
import { loadReceiptDetail } from "../review/receipt-detail.js";

/**
 * Registers the receipt routes for fetching receipt details and receipt images.
 * @param app The Express application instance.
 * @param db The database instance.
 * @param dataRoot The root directory for receipt data.
 * @param logger The logger instance.
 */
export function registerReceiptRoutes(
  app: Express,
  db: Database,
  dataRoot: string,
  logger: Logger,
) {
  const receiptsRoot = resolve(dataRoot, "receipts");

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
}
