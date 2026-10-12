import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createBackendLifecycle } from "../src/startup.js";

// Test suite for verifying the behavior of the backend lifecycle management, including worker readiness, HTTP server listening, and resource cleanup.
test("backend listens only after worker readiness and shuts down once", async (t) => {
  let ready!: () => void;
  let listening = false;
  let workerStops = 0;
  let databaseCloses = 0;
  let closed!: () => void;
  const databaseClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const lifecycle = createBackendLifecycle(
    {
      start: () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
      stop: () => {
        workerStops++;
      },
    },
    () => {
      listening = true;
      return createServer().listen(0, "127.0.0.1");
    },
    () => {
      databaseCloses++;
      closed();
    },
  );
  t.after(() => lifecycle.stop());
  const starting = lifecycle.start();
  assert.equal(listening, false);
  ready();
  assert.equal(await starting, true);
  assert.equal(listening, true);
  lifecycle.stop();
  lifecycle.stop();
  await databaseClosed;
  assert.equal(workerStops, 1);
  assert.equal(databaseCloses, 1);
});

// Test case for verifying that a worker startup failure correctly closes resources without starting the HTTP server.
test("worker startup failure closes resources without listening", async () => {
  let workerStopped = false;
  let databaseClosed = false;
  const lifecycle = createBackendLifecycle(
    {
      start: async () => {
        throw new Error("Initialization failed");
      },
      stop: () => {
        workerStopped = true;
      },
    },
    () => {
      throw new Error("Must not listen");
    },
    () => {
      databaseClosed = true;
    },
  );
  await assert.rejects(lifecycle.start(), { message: "Initialization failed" });
  assert.equal(workerStopped, true);
  assert.equal(databaseClosed, true);
});

// Test case for verifying that shutting down the backend during worker initialization prevents the HTTP server from starting and ensures proper resource cleanup.
test("shutdown during initialization never opens the HTTP port", async () => {
  let ready!: () => void;
  let databaseCloses = 0;
  const lifecycle = createBackendLifecycle(
    {
      start: () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
      stop: () => {},
    },
    () => {
      throw new Error("Must not listen");
    },
    () => {
      databaseCloses++;
    },
  );
  const starting = lifecycle.start();
  lifecycle.stop();
  ready();
  assert.equal(await starting, false);
  assert.equal(databaseCloses, 1);
});

// Test that shutting down the backend during an active request allows the request to complete before stopping the worker and closing the database.
test("shutdown drains an active request before stopping the worker and closing the database", async (t) => {
  let finish!: () => void;
  const finishRequest = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered!: () => void;
  const requestEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let closed!: () => void;
  const databaseClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const events: string[] = [];
  const server = createServer(async (_request, response) => {
    entered();
    await finishRequest;
    assert.equal(events.includes("worker.stop"), false);
    events.push("request.complete");
    response.end("completed with worker available");
  });
  const lifecycle = createBackendLifecycle(
    {
      start: async () => {},
      stop: () => {
        events.push("worker.stop");
      },
    },
    () => server.listen(0, "127.0.0.1"),
    () => {
      events.push("database.close");
      closed();
    },
  );
  t.after(() => {
    finish();
    lifecycle.stop();
  });
  await lifecycle.start();
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = fetch(`http://127.0.0.1:${address.port}/`);
  await requestEntered;
  lifecycle.stop();
  lifecycle.stop();
  assert.equal(server.listening, false);
  assert.deepEqual(events, []);
  finish();
  assert.equal(
    await (await response).text(),
    "completed with worker available",
  );
  await databaseClosed;
  assert.deepEqual(events, [
    "request.complete",
    "worker.stop",
    "database.close",
  ]);
});
