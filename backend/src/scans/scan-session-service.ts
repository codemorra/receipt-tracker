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
  Corners,
  PreviewResult,
  ProcessResult,
  PythonWorkerClient,
  Rotation,
} from "../worker/python-worker-client.js";
import { isRotation } from "../worker/python-worker-client.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const STALE_SCAN_AGE_MS = 24 * 60 * 60 * 1000;

export class InvalidCornersError extends Error {}
export class InvalidRotationError extends Error {}

export class InvalidUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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

// Supported image types and their validation logic.
const imageTypes = {
  "image/jpeg": {
    extension: "jpg",
    matches: (data: Buffer) =>
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff,
  },
  "image/png": {
    extension: "png",
    matches: (data: Buffer) =>
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/webp": {
    extension: "webp",
    matches: (data: Buffer) =>
      data.length >= 12 &&
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP",
  },
};

// Validates an uploaded image, ensuring it matches a supported type and size.
export function validateUpload(
  contentType: string | undefined,
  data: unknown,
): keyof typeof imageTypes {
  const type = contentType?.split(";")[0].trim().toLowerCase();
  if (!type || !(type in imageTypes)) {
    throw new InvalidUploadError("Unsupported image type", 415);
  }
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new InvalidUploadError("Image is empty", 400);
  }
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new InvalidUploadError("Image is too large", 413);
  }
  const imageType = type as keyof typeof imageTypes;
  if (!imageTypes[imageType].matches(data)) {
    throw new InvalidUploadError("Image content does not match its type", 400);
  }
  return imageType;
}

// Checks if a given string is a valid scan ID.
export function isScanId(value: string): boolean {
  const parts = value.split("-");
  const sizes = [8, 4, 4, 4, 12];
  return (
    parts.length === sizes.length &&
    parts.every(
      (part, index) =>
        part.length === sizes[index] &&
        [...part.toLowerCase()].every((character) =>
          "0123456789abcdef".includes(character),
        ),
    )
  );
}

// Service class for managing scan sessions, including creation and preview retrieval.
export class ScanSessionService {
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

    const directory = join(this.root, scanId);
    let session: { originalName: string; rotation?: Rotation };
    try {
      session = JSON.parse(
        await readFile(join(directory, "session.json"), "utf8"),
      ) as { originalName: string; rotation?: Rotation };
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    if (typeof session.originalName !== "string") {
      throw new Error("Invalid scan session metadata");
    }
    const selectedRotation = rotation ?? session.rotation ?? 0;
    if (!isRotation(selectedRotation)) {
      throw new Error("Invalid scan session rotation");
    }

    const archivePath = join(directory, "archive.webp");
    const ocrPath = join(directory, "ocr.webp");
    const processingId = randomUUID();
    const temporaryArchive = join(directory, `archive-${processingId}.webp`);
    const temporaryOcr = join(directory, `ocr-${processingId}.webp`);
    try {
      const result = await this.worker.requestProcess(
        join(directory, session.originalName),
        corners,
        temporaryArchive,
        temporaryOcr,
        selectedRotation,
      );
      await rename(temporaryOcr, ocrPath);
      await rename(temporaryArchive, archivePath);
      return {
        scanId,
        archiveUrl: `/api/scans/${scanId}/archive`,
        ...result,
      };
    } finally {
      await Promise.all([
        rm(temporaryArchive, { force: true }),
        rm(temporaryOcr, { force: true }),
      ]);
    }
  }

  // Service method for retrieving the file path of the OCR image for a scan session.
  async cancel(scanId: string): Promise<boolean> {
    if (!isScanId(scanId)) return false;
    const directory = join(this.root, scanId);
    try {
      await access(join(directory, "session.json"));
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
    await rm(directory, { recursive: true });
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

/**
 * Checks if the given value conforms to the Corners interface.
 * @param value The value to check.
 * @returns True if the value conforms to the Corners interface, false otherwise.
 */
function isCorners(value: unknown): value is Corners {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const corners = value as Record<string, unknown>;
  const names = ["topLeft", "topRight", "bottomRight", "bottomLeft"];
  if (Object.keys(corners).length !== names.length) return false;
  return names.every((name) => {
    const point = corners[name];
    return (
      Array.isArray(point) &&
      point.length === 2 &&
      point.every(
        (coordinate) =>
          typeof coordinate === "number" &&
          Number.isFinite(coordinate) &&
          coordinate >= 0 &&
          coordinate <= 1,
      )
    );
  });
}
