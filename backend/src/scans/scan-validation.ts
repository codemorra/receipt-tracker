import type { Corners } from "../worker/worker-protocol.js";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

// Supported image types and their validation logic.
export const imageTypes = {
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

/**
 * Checks if the given value conforms to the Corners interface.
 * @param value The value to check.
 * @returns True if the value conforms to the Corners interface, false otherwise.
 */
export function isCorners(value: unknown): value is Corners {
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
