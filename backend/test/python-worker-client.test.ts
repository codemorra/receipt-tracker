import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PythonWorkerClient,
  WorkerUnavailableError,
  WorkerRequestError,
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
test("unexpected worker exit rejects old requests and recovers on the next attempt", async (t) => {
  const events: string[] = [];
  const worker = new PythonWorkerClient(
    process.execPath,
    [fixture],
    undefined,
    (_level, operation) => {
      events.push(operation);
    },
  );
  t.after(() => worker.stop());
  await worker.start();

  const crash = worker.requestPreview("crash", "preview.webp");
  const queued = worker.requestPreview("20", "queued.webp");
  await Promise.all([
    assert.rejects(crash, WorkerUnavailableError),
    assert.rejects(queued, WorkerUnavailableError),
  ]);
  assert.equal(worker.state, "failed");
  assert.ok(events.includes("worker.exited"));
  const [first, second] = await Promise.all([
    worker.requestPreview("10", "preview.webp"),
    worker.requestPreview("30", "preview-2.webp"),
  ]);
  assert.equal(first.width, 10);
  assert.equal(second.width, 30);
  assert.equal(worker.state, "ready");
  assert.equal(
    events.filter((event) => event === "worker.restarting").length,
    1,
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

// Test case for verifying that the worker carries the preview orientation and sends the selected process rotation.
test("worker carries preview orientation and sends the selected process rotation", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  t.after(() => worker.stop());
  await worker.start();
  const preview = await worker.requestPreview("100", "preview.webp");
  assert.equal(preview.rotation, 0);
  const result = await worker.requestProcess(
    "receipt.png",
    {
      topLeft: [0, 0],
      topRight: [1, 0],
      bottomRight: [1, 1],
      bottomLeft: [0, 1],
    },
    "archive.webp",
    "ocr.webp",
    90,
  );
  assert.equal(result.width, 200);
  assert.equal(result.height, 100);
});

// Test case for verifying that requests wait for the worker to become ready if it is delayed.
test("requests wait for delayed worker readiness", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture, "50"]);
  t.after(() => worker.stop());
  const starting = worker.start();
  assert.equal(worker.state, "starting");
  const preview = worker.requestPreview("10", "preview.webp");
  await starting;
  assert.equal((await preview).width, 10);
});

// Test case for verifying that the worker correctly handles failed recovery and rejects subsequent requests without entering a retry loop.
test("failed recovery rejects requests without starting a retry loop", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-worker-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const events: string[] = [];
  const worker = new PythonWorkerClient(
    process.execPath,
    [fixture, "fail-recovery", join(directory, "started")],
    undefined,
    (_level, operation) => events.push(operation),
  );
  t.after(() => worker.stop());
  await worker.start();
  await assert.rejects(
    worker.requestPreview("crash", "preview.webp"),
    WorkerUnavailableError,
  );
  await Promise.all([
    assert.rejects(
      worker.requestPreview("10", "a.webp"),
      WorkerUnavailableError,
    ),
    assert.rejects(
      worker.requestPreview("20", "b.webp"),
      WorkerUnavailableError,
    ),
  ]);
  assert.equal(worker.state, "failed");
  assert.equal(
    events.filter((event) => event === "worker.restarting").length,
    1,
  );
});

// Test case for verifying that request errors do not leave the worker in a failed state and it remains ready for subsequent requests.
test("request errors leave the worker ready", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  t.after(() => worker.stop());
  await worker.start();
  await assert.rejects(
    worker.requestPreview("request-error", "preview.webp"),
    WorkerRequestError,
  );
  assert.equal(worker.state, "ready");
  assert.equal((await worker.requestPreview("10", "preview.webp")).width, 10);
});

// Test case for verifying that stopping the worker during initialization prevents it from recovering.
test("stopping during initialization prevents recovery", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture, "100"]);
  t.after(() => worker.stop());
  const starting = worker.start();
  worker.stop();
  await assert.rejects(starting, WorkerUnavailableError);
  await assert.rejects(
    worker.requestPreview("10", "preview.webp"),
    WorkerUnavailableError,
  );
  assert.equal(worker.state, "stopped");
});

// Test case for verifying that a startup timeout correctly fails the worker and rejects any waiting requests.
test("startup timeout fails the worker and rejects waiting requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const worker = new PythonWorkerClient(process.execPath, [
    "-e",
    "process.stdin.resume()",
  ]);
  t.after(() => worker.stop());
  const starting = assert.rejects(worker.start(), {
    message: "Worker startup timed out",
  });
  const preview = assert.rejects(
    worker.requestPreview("10", "preview.webp"),
    WorkerUnavailableError,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  await Promise.all([starting, preview]);
  assert.equal(worker.state, "failed");
});

// Test case for verifying that a request timeout correctly rejects queued work and allows a fresh attempt.
test("request timeout rejects queued work and allows a fresh attempt", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  t.after(() => worker.stop());
  await worker.start();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hanging = assert.rejects(
    worker.requestPreview("hang-request", "preview.webp"),
    WorkerUnavailableError,
  );
  const queued = assert.rejects(
    worker.requestPreview("20", "queued.webp"),
    WorkerUnavailableError,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(60_000);
  await Promise.all([hanging, queued]);
  assert.equal(worker.state, "failed");
  assert.equal((await worker.requestPreview("10", "preview.webp")).width, 10);
});

// Test case for verifying that stopping a recovering worker rejects any new requests.
test("stopping a recovering worker rejects the new request", async (t) => {
  const worker = new PythonWorkerClient(process.execPath, [fixture]);
  t.after(() => worker.stop());
  await worker.start();
  await assert.rejects(
    worker.requestPreview("crash", "preview.webp"),
    WorkerUnavailableError,
  );
  const recovering = assert.rejects(
    worker.requestPreview("10", "preview.webp"),
    WorkerUnavailableError,
  );
  worker.stop();
  await recovering;
  assert.equal(worker.state, "stopped");
});
