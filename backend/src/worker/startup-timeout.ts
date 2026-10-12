export const DEFAULT_WORKER_START_TIMEOUT_MS = 180_000;
const MAX_TIMER_MS = 2_147_483_647;

// Error thrown when the worker startup configuration is invalid.
export class WorkerStartupConfigurationError extends Error {
  name = "WorkerStartupConfigurationError";
}

/**
 * Parses the worker start timeout from the environment variable.
 * Throws a WorkerStartupConfigurationError if the value is invalid.
 * @param value The environment variable value to parse.
 * @returns The parsed worker start timeout in milliseconds.
 */
export function parseWorkerStartTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WORKER_START_TIMEOUT_MS;
  const timeout = Number(value);
  if (
    !/^[0-9]+$/.test(value) ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > MAX_TIMER_MS
  ) {
    throw new WorkerStartupConfigurationError(
      `PYTHON_WORKER_START_TIMEOUT_MS must be a positive integer between 1 and ${MAX_TIMER_MS} ms`,
    );
  }
  return timeout;
}
