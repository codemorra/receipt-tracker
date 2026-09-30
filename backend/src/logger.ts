import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "info" | "warn" | "error";

// Defines the structure of log fields used in the application.
export interface LogFields {
  scanId?: string;
  receiptId?: number;
  durationMs?: number;
  ocrDurationMs?: number;
  workerDurationMs?: number;
  llmDurationMs?: number;
  ollamaTotalDurationMs?: number;
  loadDurationMs?: number;
  promptEvalCount?: number;
  promptEvalDurationMs?: number;
  evalCount?: number;
  evalDurationMs?: number;
  model?: string;
  errorType?: string;
  stage?: string;
  phase?: string;
  port?: number;
  signal?: string;
  exitCode?: number;
}

// Defines the logger function type used in the application.
export type Logger = (
  level: LogLevel,
  operation: string,
  fields?: LogFields,
) => void;

export const silentLogger: Logger = () => {};

// Returns a string representing the type of the given error.
export function errorType(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

/**
 * Creates a logger that writes log entries to the specified file.
 * @param filename - The path to the log file.
 * @returns A logger function that writes log entries to the file.
 */
export function createFileLogger(filename: string): Logger {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  return (level, operation, fields = {}) => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      operation,
      ...fields,
    });
    try {
      appendFileSync(filename, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("Application log write failed", errorType(error));
    }
    if (level === "error") console.error(line);
  };
}
