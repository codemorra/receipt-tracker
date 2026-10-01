import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createFileLogger, errorType } from "../src/logger.js";

// Tests for the file-based logger implementation.
test("writes structured logfile entries without copying error messages", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "receipt-log-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  t.mock.method(console, "error", () => {});
  const filename = join(directory, "logs", "backend.log");
  const logger = createFileLogger(filename);
  logger("info", "scan.llm.complete", {
    scanId: "scan-1",
    durationMs: 1250,
    promptEvalCount: 200,
  });
  logger("error", "scan.process.failed", {
    scanId: "scan-1",
    errorType: errorType(new Error("private receipt text")),
  });

  const content = readFileSync(filename, "utf8");
  const entries = content
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);
  assert.ok(Number.isFinite(Date.parse(entries[0].timestamp)));
  assert.deepEqual(
    { ...entries[0], timestamp: undefined },
    {
      timestamp: undefined,
      level: "info",
      operation: "scan.llm.complete",
      scanId: "scan-1",
      durationMs: 1250,
      promptEvalCount: 200,
    },
  );
  assert.equal(entries[1].errorType, "Error");
  assert.equal(content.includes("private receipt text"), false);
});

const maxLogBytes = 5 * 1024 * 1024;

// Fixture for creating a temporary log directory and file for testing log rotation.
function logFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "receipt-log-rotation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "backend.log");
  return { directory, filename };
}

// Seeds the log file with a specified size to simulate a pre-existing log for rotation testing.
function seedLog(filename: string, size: number, operation = "seed") {
  const base = JSON.stringify({ operation, padding: "" }) + "\n";
  writeFileSync(
    filename,
    JSON.stringify({
      operation,
      padding: "x".repeat(size - Buffer.byteLength(base)),
    }) + "\n",
    { mode: 0o600 },
  );
}

// Reads and parses all log entries from the specified log file.
function logEntries(filename: string) {
  return readFileSync(filename, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

// Test case for verifying that log rotation occurs correctly when the next entry exceeds the maximum log size.
test("keeps complete JSON records and rotates only when the next entry exceeds the limit", (t) => {
  const { filename } = logFixture(t);
  const timestamp = "2026-10-01T12:00:00.000Z";
  t.mock.method(Date.prototype, "toISOString", () => timestamp);
  const bytes = Buffer.byteLength(
    JSON.stringify({ timestamp, level: "info", operation: "next" }) + "\n",
  );
  seedLog(filename, maxLogBytes - bytes);
  const logger = createFileLogger(filename);
  logger("info", "next");
  assert.equal(statSync(filename).size, maxLogBytes);
  assert.equal(existsSync(`${filename}.1`), false);
  logger("info", "after-rotation");
  assert.deepEqual(
    logEntries(`${filename}.1`).map((entry) => entry.operation),
    ["seed", "next"],
  );
  assert.equal(logEntries(filename)[0].operation, "after-rotation");
  assert.equal(statSync(filename).mode & 0o777, 0o600);
  assert.equal(statSync(`${filename}.1`).mode & 0o777, 0o600);
});

// Test case for verifying that log rotation correctly counts UTF-8 bytes rather than characters.
test("rotation counts UTF-8 bytes rather than characters", (t) => {
  const { filename } = logFixture(t);
  const timestamp = "2026-10-01T12:00:00.000Z";
  t.mock.method(Date.prototype, "toISOString", () => timestamp);
  const operation = "äöü€";
  const entry = JSON.stringify({ timestamp, level: "info", operation }) + "\n";
  seedLog(filename, maxLogBytes - entry.length);
  createFileLogger(filename)("info", operation);
  assert.equal(existsSync(`${filename}.1`), true);
  assert.equal(logEntries(filename)[0].operation, operation);
});

// Test case for verifying that only the latest three log backups are kept and that large logs are correctly recognized after a restart.
test("keeps the latest three backups in order and recognizes large logs after restart", (t) => {
  const { directory, filename } = logFixture(t);
  for (let index = 1; index <= 5; index++) {
    seedLog(filename, maxLogBytes + 1, `run-${index}`);
    createFileLogger(filename)("info", `current-${index}`);
  }
  assert.deepEqual(readdirSync(directory).sort(), [
    "backend.log",
    "backend.log.1",
    "backend.log.2",
    "backend.log.3",
  ]);
  assert.equal(logEntries(filename)[0].operation, "current-5");
  for (let index = 1; index <= 3; index++) {
    assert.equal(
      logEntries(`${filename}.${index}`)[0].operation,
      `run-${6 - index}`,
    );
  }
});

// Test case for verifying that a rotation failure still attempts to write the current log record.
test("rotation failure still attempts to write the current record", (t) => {
  const { filename } = logFixture(t);
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args));
  seedLog(filename, maxLogBytes);
  mkdirSync(`${filename}.3`);
  writeFileSync(join(`${filename}.3`, "blocked"), "keep");
  assert.doesNotThrow(() =>
    createFileLogger(filename)("info", "still-written"),
  );
  assert.equal(logEntries(filename).at(-1).operation, "still-written");
  assert.equal(errors.length, 1);
  assert.equal(errors[0][0], "Application log rotation failed");
});

// Test case for verifying that a file write failure does not escape the logger.
test("file write failure does not escape the logger", (t) => {
  const { filename } = logFixture(t);
  t.mock.method(console, "error", () => {});
  const logger = createFileLogger(filename);
  mkdirSync(filename);
  assert.doesNotThrow(() => logger("error", "failed-write"));
});
