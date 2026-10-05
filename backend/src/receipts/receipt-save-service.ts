import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "../db/database.js";
import { errorType, silentLogger, type Logger } from "../logger.js";
import type { ScanSessionService } from "../scans/scan-session-service.js";
import { finalSaveSchema } from "./final-save.js";
import { ScanArchiveNotFoundError } from "./receipt-errors.js";
import { persistReceipt } from "./receipt-persistence.js";

/**
 * Saves a receipt by first copying its image to the archive and then persisting it in the database.
 * @param db - The database instance.
 * @param scans - The scan session service.
 * @param dataRoot - The root directory for storing receipt images.
 * @param scanId - The ID of the scan session.
 * @param input - The raw input data for the receipt.
 * @returns The ID of the newly saved receipt.
 * @throws ScanArchiveNotFoundError if the scan archive cannot be found.
 */
export async function saveReceipt(
  db: Database,
  scans: ScanSessionService,
  dataRoot: string,
  scanId: string,
  input: unknown,
  logger: Logger = silentLogger,
): Promise<number> {
  const receipt = finalSaveSchema.parse(input);
  const archive = await scans.archivePath(scanId);
  if (!archive) throw new ScanArchiveNotFoundError("Scan archive not found");
  const imagePath = `receipts/${randomUUID()}.webp`;
  const archiveDestination = join(dataRoot, imagePath);
  await mkdir(join(dataRoot, "receipts"), { recursive: true });
  let copied = false;
  let receiptId: number;
  try {
    // Copy the receipt image to the archive before persisting the receipt in the database.
    await copyFile(archive, archiveDestination, constants.COPYFILE_EXCL);
    copied = true;
    receiptId = persistReceipt(db, receipt, imagePath);
  } catch (error) {
    logger("error", "receipt.persistence.failed", {
      scanId,
      stage: copied ? "database" : "archive_copy",
      errorType: errorType(error),
    });
    if (
      // If the error occurred because the file already exists, rethrow it.
      !copied &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw error;
    }
    try {
      // If the error occurred for any other reason, attempt to clean up the copied file.
      await rm(archiveDestination, { force: true });
    } catch (cleanupError) {
      logger("error", "receipt.archive_cleanup.failed", {
        scanId,
        errorType: errorType(cleanupError),
      });
    }
    throw error;
  }
  try {
    // Attempt to cancel the scan session for the saved receipt.
    await scans.cancel(scanId);
  } catch (error) {
    logger("error", "receipt.scan_cleanup.failed", {
      scanId,
      receiptId,
      errorType: errorType(error),
    });
  }
  return receiptId;
}
