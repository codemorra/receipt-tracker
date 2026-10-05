import type { Corners, Rotation } from "../scans/scan-orientation";
import type { ReviewDto } from "../review/review-state";
import type { ProviderId } from "./provider-settings-api";

// Interfaces and types for scan API.
export interface Scan {
  scanId: string;
  previewUrl: string;
  width: number;
  height: number;
  suggestedCorners: Corners;
  rotation: Rotation;
}

export interface ProcessedScan {
  archiveUrl: string;
  review: ReviewDto;
}

// Scan error codes and related types.
export const scanErrorCodes = [
  "invalid_upload",
  "upload_too_large",
  "unsupported_type",
  "worker_unavailable",
  "invalid_image",
  "scan_failed",
  "scan_not_found",
  "invalid_corners",
  "invalid_rotation",
  "processing_failed",
  "ollama_unavailable",
  "ollama_failed",
  "llm_unavailable",
  "llm_failed",
  "invalid_llm_response",
  "invalid_extraction",
  "provider_authentication_failed",
  "invalid_provider",
  "provider_disabled",
  "provider_configuration_incomplete",
  "default_provider_missing",
  "secret_key_unavailable",
  "secret_decryption_failed",
  "scan_cancel_failed",
  "network_error",
  "unexpected_response",
  "preview_unavailable",
  "archive_unavailable",
] as const;
export type ScanErrorCode = (typeof scanErrorCodes)[number];
export class ScanApiError extends Error {
  readonly code: ScanErrorCode;
  constructor(code: ScanErrorCode) {
    super(code);
    this.name = "ScanApiError";
    this.code = code;
  }
}

/**
 * Validates the scan file before uploading.
 * @param file - The file to validate.
 * @throws {ScanApiError} If the file is invalid.
 */
export function validateScanFile(file: Pick<File, "type" | "size">): void {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new ScanApiError("unsupported_type");
  if (file.size === 0) throw new ScanApiError("invalid_upload");
}

/**
 * Type guard for checking if a value is a record.
 * @param value - The value to check.
 * @returns True if the value is a record, false otherwise.
 */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Regular expression for validating UUIDs.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function scanPath(id: string): string {
  if (!uuid.test(id)) throw new ScanApiError("unexpected_response");
  return `/api/scans/${id}`;
}

/**
 * Sends an HTTP request and handles errors.
 * @param path - The request path.
 * @param init - The request initialization object.
 * @returns The response object.
 * @throws {ScanApiError} If the request fails or the response is invalid.
 */
async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: "no-store" });
  } catch {
    if (init.signal?.aborted) throw new DOMException("", "AbortError");
    throw new ScanApiError("network_error");
  }
  if (!response.ok && !(init.method === "DELETE" && response.status === 404)) {
    let code: ScanErrorCode = "unexpected_response";
    try {
      const payload: unknown = await response.json();
      if (record(payload))
        code = scanErrorCodes.find((code) => code === payload.error) ?? code;
    } catch {
      /* Never expose response bodies. */
    }
    throw new ScanApiError(code);
  }
  return response;
}

/**
 * Parses the JSON body of a response.
 * @param response - The response object.
 * @returns The parsed JSON value.
 * @throws {ScanApiError} If the response body is not valid JSON.
 */
async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ScanApiError("unexpected_response");
  }
}

/**
 * Uploads a scan file to the server.
 * @param file - The scan file to upload.
 * @param signal - Optional abort signal.
 * @returns The uploaded scan object.
 * @throws {ScanApiError} If the upload fails or the response is invalid.
 */
export async function uploadScan(
  file: File,
  signal?: AbortSignal,
): Promise<Scan> {
  validateScanFile(file);
  const value = await json(
    await send("/api/scans", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
      signal,
    }),
  );
  if (
    !record(value) ||
    typeof value.scanId !== "string" ||
    !uuid.test(value.scanId) ||
    value.previewUrl !== `${scanPath(value.scanId)}/preview` ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    (value.width as number) <= 0 ||
    (value.height as number) <= 0 ||
    ![0, 90, 180, 270].includes(value.rotation as number) ||
    !record(value.suggestedCorners) ||
    !["topLeft", "topRight", "bottomRight", "bottomLeft"].every((name) => {
      const point = (value.suggestedCorners as Record<string, unknown>)[name];
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
    })
  )
    throw new ScanApiError("unexpected_response");
  return {
    scanId: value.scanId,
    previewUrl: value.previewUrl as string,
    width: value.width as number,
    height: value.height as number,
    rotation: value.rotation as Rotation,
    suggestedCorners: value.suggestedCorners as Corners,
  };
}

/**
 * Processes a scan with the given corners, rotation, and provider.
 * @param scanId - The ID of the scan to process.
 * @param corners - The corners of the scan.
 * @param rotation - The rotation of the scan.
 * @param provider - The provider to use for processing.
 * @param signal - Optional abort signal.
 * @returns The processed scan object.
 * @throws {ScanApiError} If the processing fails or the response is invalid.
 */
export async function processScan(
  scanId: string,
  corners: Corners,
  rotation: Rotation,
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<ProcessedScan> {
  const value = await json(
    await send(`${scanPath(scanId)}/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corners, rotation, provider }),
      signal,
    }),
  );
  if (
    !record(value) ||
    value.archiveUrl !== `${scanPath(scanId)}/archive` ||
    !record(value.review) ||
    value.review.scanId !== scanId ||
    !record(value.review.merchant) ||
    !Array.isArray(value.review.items) ||
    !Array.isArray(value.review.discounts) ||
    !Array.isArray(value.review.warnings)
  )
    throw new ScanApiError("unexpected_response");
  return {
    archiveUrl: value.archiveUrl as string,
    review: value.review as unknown as ReviewDto,
  };
}

/**
 * Deletes a scan with the given ID.
 * @param scanId - The ID of the scan to delete.
 * @param signal - Optional abort signal.
 * @returns A promise that resolves when the scan is deleted.
 * @throws {ScanApiError} If the deletion fails.
 */
export async function deleteScan(
  scanId: string,
  signal?: AbortSignal,
): Promise<void> {
  await send(scanPath(scanId), { method: "DELETE", signal });
}
