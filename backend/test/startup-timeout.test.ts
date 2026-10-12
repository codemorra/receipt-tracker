import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkerStartTimeout,
  WorkerStartupConfigurationError,
} from "../src/worker/startup-timeout.js";

// Test suite for verifying the behavior of the worker startup timeout parsing logic.
test("missing worker timeout uses 180000 ms", () => {
  assert.equal(parseWorkerStartTimeout(undefined), 180_000);
});

// Test case for verifying that the default worker timeout is used when the environment variable is missing.
test("worker timeout accepts positive integer milliseconds within Node's range", () => {
  for (const value of ["1", "45000", "180000", "2147483647"]) {
    assert.equal(parseWorkerStartTimeout(value), Number(value));
  }
});

// Test case for verifying that invalid worker timeout values result in a configuration error.
test("invalid worker timeout fails with a configuration error", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "abc",
    "1.5",
    "Infinity",
    "NaN",
    "2147483648",
    "999999999999999999999999",
    " 100",
    "100 ",
    "1e3",
    "0x10",
    "+1",
  ]) {
    assert.throws(() => parseWorkerStartTimeout(value), {
      name: WorkerStartupConfigurationError.name,
      message:
        "PYTHON_WORKER_START_TIMEOUT_MS must be a positive integer between 1 and 2147483647 ms",
    });
  }
});
