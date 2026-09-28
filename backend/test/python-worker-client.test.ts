import assert from "node:assert/strict";
import { resolve } from "node:path";
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
