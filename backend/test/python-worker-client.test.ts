import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PythonWorkerClient,
  WorkerUnavailableError,
} from "../src/worker/python-worker-client.js";

// Path to the fixture Python worker script.
const fixture = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures/preview-worker.cjs",
);

// Test for the Python worker client, verifying request sequencing and failure handling.
test("worker waits for ready and maps sequenced responses by requestId", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  t.after(() => worker.stop());
  await worker.start();
  assert.equal(worker.state, "ready");

  const [first, second] = await Promise.all([
    worker.requestPreview("10", "first.webp"),
    worker.requestPreview("20", "second.webp"),
  ]);
  assert.equal(first.width, 10);
  assert.equal(second.width, 20);
  assert.deepEqual(first.suggestedCorners.topLeft, [0, 0]);

  const processed = await worker.requestProcess(
    "receipt.png",
    {
      topLeft: [0, 0],
      topRight: [1, 0],
      bottomRight: [1, 1],
      bottomLeft: [0, 1],
    },
    "archive.webp",
    "ocr.webp",
  );
  assert.equal(processed.plainText, "RECEIPT");
  assert.equal(processed.ocrDurationMs, 12.5);
  assert.deepEqual(processed.lines[0], {
    index: 0,
    text: "RECEIPT",
    confidence: 0.95,
    box: [0, 0, 1, 1],
  });
  assert.deepEqual(processed.rows, [
    { rowIndex: 0, segments: [{ text: "RECEIPT", x: 0 }], lineIndexes: [0] },
  ]);

  worker.stop();
  assert.equal(worker.state, "stopped");
  await assert.rejects(
    worker.requestPreview("30", "third.webp"),
    WorkerUnavailableError,
  );
});

// Test for the Python worker client handling unexpected worker exits and failure states.
test("unexpected worker exit enters failed state and rejects requests", async () => {
  const events: string[] = [];
  const worker = new PythonWorkerClient(
    process.execPath,
    [fixture],
    undefined,
    (_level, operation) => {
      events.push(operation);
    },
  );
  await worker.start();

  await assert.rejects(
    worker.requestPreview("crash", "preview.webp"),
    WorkerUnavailableError,
  );
  assert.equal(worker.state, "failed");
  assert.ok(events.includes("worker.exited"));
  await assert.rejects(
    worker.requestPreview("10", "preview.webp"),
    WorkerUnavailableError,
  );
});

// Test for the Python worker client starting in the configured working directory.
test("worker starts in the configured working directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-worker-cwd-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = `
    if (process.cwd() !== ${JSON.stringify(directory)}) process.exit(2);
    process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
    process.stdin.resume();
  `;
  const worker = new PythonWorkerClient(
    process.execPath,
    ["-e", script],
    directory,
  );
  t.after(() => worker.stop());

  await worker.start();
  assert.equal(worker.state, "ready");
});

// Test for the Python worker client rejecting rows that lose, duplicate, or alter OCR evidence.
test("worker rejects rows that lose, duplicate, or alter OCR evidence", async (t) => {
  const lines = [
    { index: 0, text: "Snack", confidence: 0.9, box: [0.1, 0.2, 0.5, 0.3] },
    { index: 1, text: "0,99", confidence: 0.9, box: [0.7, 0.2, 0.9, 0.3] },
  ];
  const segments = [
    { text: "Snack", x: 0.1 },
    { text: "0,99", x: 0.7 },
  ];
  const invalidRows = [
    [],
    [{ rowIndex: 0, segments: [segments[0]], lineIndexes: [0] }],
    [{ rowIndex: 0, segments, lineIndexes: [0, 0] }],
    [{ rowIndex: 0, segments, lineIndexes: [1, 0] }],
    [
      {
        rowIndex: 0,
        segments: [segments[0], { text: "9,99", x: 0.7 }],
        lineIndexes: [0, 1],
      },
    ],
    [
      {
        rowIndex: 0,
        segments: [segments[0], { text: "0,99", x: 0.2 }],
        lineIndexes: [0, 1],
      },
    ],
  ];
  for (const rows of invalidRows) {
    const result = {
      status: "ok",
      width: 100,
      height: 200,
      plainText: "Snack\n0,99",
      lines,
      rows,
      ocrDurationMs: 1,
    };
    const script = `
      process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
      require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
        const request = JSON.parse(line);
        process.stdout.write(JSON.stringify({ ...${JSON.stringify(result)}, requestId: request.requestId }) + "\\n");
      });
    `;
    const worker = new PythonWorkerClient(process.execPath, ["-e", script]);
    t.after(() => worker.stop());
    await worker.start();
    await assert.rejects(
      worker.requestProcess(
        "receipt.png",
        {
          topLeft: [0, 0],
          topRight: [1, 0],
          bottomRight: [1, 1],
          bottomLeft: [0, 1],
        },
        "archive.webp",
        "ocr.webp",
      ),
      { message: "Invalid worker response" },
    );
    worker.stop();
  }
});
