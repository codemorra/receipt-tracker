import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PythonWorkerClient } from "../src/worker/python-worker-client.js";

// Real child processes verify both SIGTERM and the existing SIGKILL fallback.
for (const ignoreTerm of [false, true]) {
  // Test case for verifying that the worker correctly handles startup timeouts and cleans up the worker process.
  test(`configured startup timeout cleans up worker (${ignoreTerm ? "SIGKILL" : "SIGTERM"})`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "receipt-worker-timeout-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const initialized = join(directory, "initialized");
    const terminated = join(directory, "terminated");
    const script = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {
        fs.writeFileSync(${JSON.stringify(terminated)}, 'SIGTERM');
        if (!${ignoreTerm}) process.exit(0);
      });
      fs.writeFileSync(${JSON.stringify(initialized)}, String(process.pid));
      process.stdin.resume();
    `;
    const events: { operation: string; durationMs?: number }[] = [];
    const worker = new PythonWorkerClient(
      process.execPath,
      ["-e", script],
      undefined,
      (_level, operation, fields) =>
        events.push({ operation, durationMs: fields?.durationMs }),
      120_000,
    );
    t.after(() => worker.stop());
    t.mock.timers.enable({ apis: ["setTimeout"], now: 0 });
    const starting = assert.rejects(worker.start(), {
      message: "Worker startup timed out after 120000 ms",
    });
    const waitFor = async (condition: () => Promise<boolean>) => {
      const deadline = Date.now() + 5_000;
      while (!(await condition())) {
        assert.ok(
          Date.now() < deadline,
          "child process did not reach expected state",
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    };
    let pid: number | undefined;
    t.after(() => {
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    });
    await waitFor(async () => {
      try {
        pid = Number(await readFile(initialized, "utf8"));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return false;
      }
    });
    t.mock.timers.tick(119_999);
    assert.equal(worker.state, "starting");
    t.mock.timers.tick(1);
    await starting;
    assert.equal(worker.state, "failed");
    assert.ok(
      events.some(
        (event) =>
          event.operation === "worker.startup.timed_out" &&
          event.durationMs === 120_000,
      ),
    );
    await waitFor(async () => {
      try {
        return (await readFile(terminated, "utf8")) === "SIGTERM";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return false;
      }
    });
    if (ignoreTerm) {
      t.mock.timers.tick(4_999);
      assert.equal(
        events.some((event) => event.operation === "worker.termination.forced"),
        false,
      );
      process.kill(pid!, 0);
      t.mock.timers.tick(1);
      assert.ok(
        events.some((event) => event.operation === "worker.termination.forced"),
      );
    }
    await waitFor(async () => {
      try {
        process.kill(pid!, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        return true;
      }
    });
    assert.equal(
      events.filter((event) => event.operation === "worker.starting").length,
      1,
    );
    assert.equal(
      events.some((event) => event.operation === "worker.restarting"),
      false,
    );
  });
}
