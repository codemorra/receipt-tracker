import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { errorType, silentLogger, type Logger } from "../logger.js";
import type {
  PreviewResult,
  ProcessResult,
  Rotation,
} from "../worker/worker-protocol.js";
import { isRotation } from "../worker/worker-protocol.js";
import type { PythonWorkerClient } from "../worker/python-worker-client.js";
import {
  imageTypes,
  InvalidCornersError,
  InvalidRotationError,
  isCorners,
  isScanId,
  validateUpload,
} from "./scan-validation.js";

export const STALE_SCAN_AGE_MS = 24 * 60 * 60 * 1000;

// Interface representing a scan session, including preview result and metadata.
export interface ScanSession extends PreviewResult {
  scanId: string;
  previewUrl: string;
}

// Interface representing a processed scan, including process result and metadata.
export interface ProcessedScan extends ProcessResult {
  scanId: string;
  archiveUrl: string;
}

// Service class for managing scan sessions, including creation and preview retrieval.
export class ScanSessionService {
  // Only file-producing work is tracked; no worker/provider cancellation protocol.
  private readonly cancellations = new Map<string, Promise<boolean>>();
  private readonly processing = new Map<
    string,
    { cancelled: boolean; done: Promise<void> }
  >();
  constructor(
    private readonly root: string,
    private readonly worker: Pick<
      PythonWorkerClient,
      "requestPreview" | "requestProcess"
    >,
    private readonly logger: Logger = silentLogger,
  ) {}

  // Cleans up stale scan sessions that have not been modified within the defined stale age.
  async cleanupStaleSessions(now = Date.now()): Promise<number> {
    let removedSessions = 0;
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !isScanId(entry.name)) continue;
        const directory = join(this.root, entry.name);
        try {
          const information = await lstat(directory);
          if (
            !information.isDirectory() ||
            information.mtimeMs > now - STALE_SCAN_AGE_MS
          )
            continue;
          await rm(directory, { recursive: true });
          removedSessions++;
        } catch (error) {
          if (!isMissingFile(error)) {
            this.logger("warn", "scan.stale_cleanup.failed", {
              scanId: entry.name,
              errorType: errorType(error),
            });
          }
        }
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        this.logger("warn", "scan.stale_cleanup.failed", {
          errorType: errorType(error),
        });
      }
    }
    this.logger("info", "scan.stale_cleanup.complete", { removedSessions });
    return removedSessions;
  }

  // Service method for creating a new scan session with the provided image data.
  async create(
    contentType: string | undefined,
    data: unknown,
  ): Promise<ScanSession> {
    const imageType = validateUpload(contentType, data);
    const image = data as Buffer;
    const scanId = randomUUID();
    const directory = join(this.root, scanId);
    const originalName = `original.${imageTypes[imageType].extension}`;
    const previewName = "preview.webp";

    await mkdir(this.root, { recursive: true });
    await mkdir(directory);
    try {
      await writeFile(join(directory, originalName), image, { flag: "wx" });
      const preview = await this.worker.requestPreview(
        join(directory, originalName),
        join(directory, previewName),
      );
      const session = {
        scanId,
        createdAt: new Date().toISOString(),
        originalName,
        previewName,
        ...preview,
      };
      await writeFile(
        join(directory, "session.json"),
        JSON.stringify(session, null, 2),
        { flag: "wx" },
      );
      return {
        scanId,
        previewUrl: `/api/scans/${scanId}/preview`,
        ...preview,
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  // Service method for processing a scan session with the given corners.
  async process(
    scanId: string,
    corners: unknown,
    rotation?: unknown,
  ): Promise<ProcessedScan | undefined> {
    if (!isScanId(scanId)) return undefined;
    if (!isCorners(corners)) throw new InvalidCornersError("Invalid corners");
    if (rotation !== undefined && !isRotation(rotation)) {
      throw new InvalidRotationError("Invalid rotation");
    }

    // Check if the scan has been cancelled or is already processing.
    if (this.cancellations.has(scanId)) return undefined;
    if (this.processing.has(scanId))
      throw new Error("Scan is already processing");
    let finish!: () => void;
    const work = {
      cancelled: false,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
    };
    this.processing.set(scanId, work);
    try {
      // Determine the directory for the scan session.
      const directory = join(this.root, scanId);
      let session: { originalName: string; rotation?: Rotation };
      try {
        // Read the scan session metadata from the session.json file.
        session = JSON.parse(
          await readFile(join(directory, "session.json"), "utf8"),
        ) as { originalName: string; rotation?: Rotation };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
      // Validate the scan session metadata.
      if (typeof session.originalName !== "string") {
        throw new Error("Invalid scan session metadata");
      }
      const selectedRotation = rotation ?? session.rotation ?? 0;
      // Determine the selected rotation for the scan session.
      if (!isRotation(selectedRotation)) {
        throw new Error("Invalid scan session rotation");
      }

      const archivePath = join(directory, "archive.webp");
      const ocrPath = join(directory, "ocr.webp");
      const processingId = randomUUID();
      const temporaryArchive = join(directory, `archive-${processingId}.webp`);
      const temporaryOcr = join(directory, `ocr-${processingId}.webp`);
      try {
        // Request the worker to process the scan with the specified parameters.
        const result = await this.worker.requestProcess(
          join(directory, session.originalName),
          corners,
          temporaryArchive,
          temporaryOcr,
          selectedRotation,
        );
        if (work.cancelled) return undefined;
        await rename(temporaryOcr, ocrPath);
        await rename(temporaryArchive, archivePath);
        if (work.cancelled) return undefined;
        return {
          scanId,
          archiveUrl: `/api/scans/${scanId}/archive`,
          ...result,
        };
      } finally {
        // Clean up the temporary files for the scan session.
        await Promise.all([
          rm(temporaryArchive, { force: true }),
          rm(temporaryOcr, { force: true }),
        ]);
      }
    } finally {
      this.processing.delete(scanId);
      finish();
    }
  }

  // Service method for cancelling a scan session and removing its temporary files.
  cancel(scanId: string): Promise<boolean> {
    if (!isScanId(scanId)) return Promise.resolve(false);
    const existing = this.cancellations.get(scanId);
    if (existing) return existing;
    const operation = this.removeSession(scanId).finally(() => {
      this.cancellations.delete(scanId);
    });
    this.cancellations.set(scanId, operation);
    return operation;
  }

  private async removeSession(scanId: string): Promise<boolean> {
    const work = this.processing.get(scanId);
    if (work) {
      work.cancelled = true;
      await work.done;
    }
    const directory = join(this.root, scanId);
    try {
      await access(join(directory, "session.json"));
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
    await rm(directory, { recursive: true, force: true });
    return true;
  }

  // Service method for retrieving the file path of the preview image for a scan session.
  async previewPath(scanId: string): Promise<string | undefined> {
    return this.imagePath(scanId, "preview.webp");
  }

  // Service method for retrieving the file path of the archive image for a scan session.
  async archivePath(scanId: string): Promise<string | undefined> {
    return this.imagePath(scanId, "archive.webp");
  }

  // Private helper method for retrieving the file path of a specific image file within a scan session.
  private async imagePath(
    scanId: string,
    filename: string,
  ): Promise<string | undefined> {
    if (!isScanId(scanId)) return undefined;
    const directory = join(this.root, scanId);
    const path = join(directory, filename);
    try {
      await access(join(directory, "session.json"));
      await access(path);
      return path;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }
}

/**
 * Checks if the given error corresponds to a missing file (ENOENT).
 * @param error The error object to check.
 * @returns True if the error indicates a missing file, false otherwise.
 */
function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
