import { once } from "node:events";
import type { Server } from "node:http";
import type { PythonWorkerClient } from "./worker/python-worker-client.js";

/**
 * Creates and manages the lifecycle of the backend server, including starting and stopping the Python worker and the HTTP server.
 * @param worker The Python worker client with start and stop methods.
 * @param listen A function that starts the HTTP server and returns the server instance.
 * @param closeDatabase A function that closes the database connection.
 * @returns An object with start and stop methods to control the backend lifecycle.
 */
export function createBackendLifecycle(
  worker: Pick<PythonWorkerClient, "start" | "stop">,
  listen: () => Server,
  closeDatabase: () => void,
) {
  let server: Server | undefined;
  let stopped = false;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    worker.stop();
    if (server) server.close(closeDatabase);
    else closeDatabase();
  }

  // Starts the backend server, including the Python worker and the HTTP server. Returns true if the server started successfully, false if it was stopped before starting.
  async function start(): Promise<boolean> {
    try {
      await worker.start();
      if (stopped) return false;
      server = listen();
      await once(server, "listening");
      return true;
    } catch (error) {
      if (stopped) return false;
      stop();
      throw error;
    }
  }

  return { start, stop };
}
