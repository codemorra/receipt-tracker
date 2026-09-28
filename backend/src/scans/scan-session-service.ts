import { randomUUID } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PreviewResult,
  PythonWorkerClient,
} from "../worker/python-worker-client.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Error class for invalid image uploads.
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
    private readonly worker: Pick<PythonWorkerClient, "requestPreview">,
  ) {}

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

  async previewPath(scanId: string): Promise<string | undefined> {
    if (!isScanId(scanId)) return undefined;
    const directory = join(this.root, scanId);
    const previewPath = join(directory, "preview.webp");
    try {
      await access(join(directory, "session.json"));
      await access(previewPath);
      return previewPath;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  }
}
