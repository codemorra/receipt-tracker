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

  worker.stop();
  assert.equal(worker.state, "stopped");
  await assert.rejects(
    worker.requestPreview("30", "third.webp"),
    WorkerUnavailableError,
  );
});

// Test for the Python worker client handling unexpected worker exits and failure states.
test("unexpected worker exit enters failed state and rejects requests", async () => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  await worker.start();

  await assert.rejects(
    worker.requestPreview("crash", "preview.webp"),
    WorkerUnavailableError,
  );
  assert.equal(worker.state, "failed");
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
