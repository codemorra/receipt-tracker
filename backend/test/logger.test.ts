import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
