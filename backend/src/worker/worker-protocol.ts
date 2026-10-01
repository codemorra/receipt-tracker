export type Corner = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Checks if a value is a valid rotation.
 * @param value The value to check.
 * @returns True if the value is a valid rotation, false otherwise.
 */
export function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

// Types and interfaces for the Python worker client.
export interface Corners {
  topLeft: Corner;
  topRight: Corner;
  bottomRight: Corner;
  bottomLeft: Corner;
}

// Result of a preview request from the Python worker.
export interface PreviewResult {
  width: number;
  height: number;
  suggestedCorners: Corners;
  rotation: Rotation;
}

// Interface representing a single line of OCR result from the Python worker.
export interface OcrLine {
  index: number;
  text: string;
  confidence: number;
  box: [number, number, number, number];
}

// Interface representing a single row of OCR result from the Python worker.
export interface OcrRow {
  rowIndex: number;
  segments: { text: string; x: number }[];
  lineIndexes: number[];
}

// Result of a process request from the Python worker.
export interface ProcessResult {
  width: number;
  height: number;
  plainText: string;
  lines: OcrLine[];
  rows: OcrRow[];
  ocrDurationMs: number;
}

/**
 * Type guard to check if a value is a valid preview result from the Python worker.
 * @param value - The value to check.
 * @returns True if the value is a valid preview result, false otherwise.
 */
export function isPreviewResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PreviewResult {
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height))
    return false;
  if ((value.width as number) <= 0 || (value.height as number) <= 0)
    return false;
  if (!isRotation(value.rotation)) return false;
  if (!value.suggestedCorners || typeof value.suggestedCorners !== "object")
    return false;
  const corners = value.suggestedCorners as Record<string, unknown>;
  return ["topLeft", "topRight", "bottomRight", "bottomLeft"].every((name) => {
    const point = corners[name];
    return (
      Array.isArray(point) &&
      point.length === 2 &&
      point.every(
        (coordinate) =>
          typeof coordinate === "number" && coordinate >= 0 && coordinate <= 1,
      )
    );
  });
}

/**
 * Type guard to check if a value is a valid process result from the Python worker.
 * @param value - The value to check.
 * @returns True if the value is a valid process result, false otherwise.
 */
export function isProcessResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ProcessResult {
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height))
    return false;
  if ((value.width as number) <= 0 || (value.height as number) <= 0)
    return false;
  if (
    typeof value.plainText !== "string" ||
    !Array.isArray(value.lines) ||
    !Array.isArray(value.rows)
  )
    return false;
  if (
    typeof value.ocrDurationMs !== "number" ||
    !Number.isFinite(value.ocrDurationMs) ||
    value.ocrDurationMs < 0
  )
    return false;
  const validLines = value.lines.every((line: unknown, index: number) => {
    if (!line || typeof line !== "object") return false;
    const item = line as Record<string, unknown>;
    if (
      item.index !== index ||
      typeof item.text !== "string" ||
      typeof item.confidence !== "number" ||
      !Number.isFinite(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1 ||
      !Array.isArray(item.box) ||
      item.box.length !== 4
    )
      return false;
    return item.box.every(
      (coordinate: unknown) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        coordinate >= 0 &&
        coordinate <= 1,
    );
  });
  const validRows =
    validLines &&
    value.rows.every((row: unknown, index: number) => {
      if (!row || typeof row !== "object") return false;
      const item = row as Record<string, unknown>;
      return (
        item.rowIndex === index &&
        Array.isArray(item.segments) &&
        item.segments.length > 0 &&
        item.segments.every((segment: unknown) => {
          if (!segment || typeof segment !== "object") return false;
          const entry = segment as Record<string, unknown>;
          return (
            typeof entry.text === "string" &&
            typeof entry.x === "number" &&
            Number.isFinite(entry.x) &&
            entry.x >= 0 &&
            entry.x <= 1
          );
        }) &&
        Array.isArray(item.lineIndexes) &&
        item.lineIndexes.length === item.segments.length &&
        item.lineIndexes.every(
          (lineIndex: unknown) =>
            Number.isInteger(lineIndex) &&
            (lineIndex as number) >= 0 &&
            (lineIndex as number) < (value.lines as unknown[]).length,
        )
      );
    });
  if (!validRows) return false;
  const lines = value.lines as OcrLine[];
  const rows = value.rows as OcrRow[];
  const indexes = rows.flatMap((row) => row.lineIndexes);
  return (
    indexes.length === lines.length &&
    indexes.every((lineIndex, index) => lineIndex === index) &&
    rows.every((row) =>
      row.segments.every((segment, index) => {
        const line = lines[row.lineIndexes[index]]!;
        return (
          segment.text === line.text &&
          Math.abs(segment.x - line.box[0]) <= 0.000501
        );
      }),
    )
  );
}
