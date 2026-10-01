import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_BACKUPS = 3;

export type LogLevel = "info" | "warn" | "error";

// Defines the structure of log fields used in the application.
export interface LogFields {
  scanId?: string;
  receiptId?: number;
  removedSessions?: number;
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
 * Rotates the log file by renaming existing backups and removing the oldest one if necessary.
 * @param filename - The path to the log file.
 * @param entryBytes - The size of the new log entry in bytes.
 */
function rotateLog(filename: string, entryBytes: number): void {
  const size = statSync(filename, { throwIfNoEntry: false })?.size ?? 0;
  if (size === 0 || size + entryBytes <= MAX_LOG_BYTES) return;
  rmSync(`${filename}.${LOG_BACKUPS}`, { force: true });
  for (let index = LOG_BACKUPS; index >= 1; index--) {
    const source = index === 1 ? filename : `${filename}.${index - 1}`;
    try {
      renameSync(source, `${filename}.${index}`);
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        throw error;
      }
    }
  }
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
    const entry = `${line}\n`;
    try {
      rotateLog(filename, Buffer.byteLength(entry, "utf8"));
    } catch (error) {
      console.error("Application log rotation failed", errorType(error));
    }
    try {
      appendFileSync(filename, entry, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      console.error("Application log write failed", errorType(error));
    }
    if (level === "error") console.error(line);
  };
}
