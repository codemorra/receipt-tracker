import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export type Corner = [number, number];

// Types and interfaces for the Python worker client.
export interface Corners {
  topLeft: Corner;
  topRight: Corner;
  bottomRight: Corner;
  bottomLeft: Corner;
}

// Result of a preview request from the Python worker.
export interface PreviewResult {
  width: number;
  height: number;
  suggestedCorners: Corners;
}

export class WorkerUnavailableError extends Error {}
export class WorkerRequestError extends Error {}

// Interface for a pending request to the Python worker.
interface PendingRequest {
  requestId: string;
  resolve: (result: PreviewResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// Client for interacting with the Python worker process.
export class PythonWorkerClient {
  state: "starting" | "ready" | "stopped" | "failed" = "stopped";
  private process?: ChildProcessWithoutNullStreams;
  private output = "";
  private pending?: PendingRequest;
  private queue: Promise<void> = Promise.resolve();
  private started = false;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private startupTimeout?: NodeJS.Timeout;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd?: string,
  ) {}

  // Starts the Python worker process and initializes the client.
  start(): Promise<void> {
    if (this.started) {
      throw new Error("Worker can only be started once");
    }
    this.started = true;
    this.state = "starting";

    return new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      try {
        const child = spawn(this.command, this.args, {
          stdio: "pipe",
          cwd: this.cwd,
        });
        this.process = child;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => this.onOutput(chunk));
        child.stderr.on("data", (chunk: Buffer) => {
          process.stderr.write(`[python-worker] ${chunk.toString()}`);
        });
        child.on("error", (error) => this.fail(error));
        child.on("exit", (code) => {
          if (this.state === "failed" || this.state === "stopped") return;
          this.state = code === 0 ? "stopped" : "failed";
          this.rejectOutstanding(
            new WorkerUnavailableError(`Worker stopped with code ${code}`),
          );
        });
        this.startupTimeout = setTimeout(() => {
          this.fail(new WorkerUnavailableError("Worker startup timed out"));
        }, 30_000);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  // Sends a preview request to the Python worker.
  requestPreview(
    originalPath: string,
    previewPath: string,
  ): Promise<PreviewResult> {
    const result = this.queue.then(() =>
      this.sendPreview(originalPath, previewPath),
    );
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Stops the Python worker process.
  stop(): void {
    if (this.state === "stopped" || this.state === "failed") return;
    this.state = "stopped";
    this.rejectOutstanding(new WorkerUnavailableError("Worker stopped"));
    this.process?.kill();
  }

  // Sends a preview request to the Python worker (internal method).
  private sendPreview(
    originalPath: string,
    previewPath: string,
  ): Promise<PreviewResult> {
    if (this.state !== "ready" || !this.process) {
      return Promise.reject(
        new WorkerUnavailableError("Worker is unavailable"),
      );
    }

    const requestId = randomUUID();
    return new Promise<PreviewResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(new WorkerUnavailableError("Worker request timed out"));
      }, 60_000);
      this.pending = { requestId, resolve, reject, timeout };
      this.process!.stdin.write(
        JSON.stringify({
          requestId,
          type: "preview",
          originalPath,
          previewPath,
        }) + "\n",
        (error) => {
          if (error) this.fail(error);
        },
      );
    });
  }

  // Handles output from the Python worker process, buffering and processing complete lines.
  private onOutput(chunk: string): void {
    this.output += chunk;
    let end = this.output.indexOf("\n");
    while (end !== -1) {
      const line = this.output.slice(0, end);
      this.output = this.output.slice(end + 1);
      this.onLine(line);
      end = this.output.indexOf("\n");
    }
  }

  // Processes a single line of output from the Python worker.
  private onLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new Error("Invalid worker JSON"));
      return;
    }
    if (!message || typeof message !== "object") {
      this.fail(new Error("Invalid worker message"));
      return;
    }
    const value = message as Record<string, unknown>;
    if (this.state === "starting" && value.type === "ready") {
      this.state = "ready";
      clearTimeout(this.startupTimeout);
      this.readyResolve?.();
      this.readyResolve = undefined;
      this.readyReject = undefined;
      return;
    }
    const pending = this.pending;
    if (
      this.state !== "ready" ||
      !pending ||
      value.requestId !== pending.requestId
    ) {
      this.fail(new Error("Unexpected worker response"));
      return;
    }
    clearTimeout(pending.timeout);
    this.pending = undefined;
    if (value.status === "error") {
      pending.reject(
        new WorkerRequestError(String(value.error ?? "Preview failed")),
      );
      return;
    }
    if (value.status !== "ok" || !isPreviewResult(value)) {
      this.fail(new Error("Invalid worker preview response"));
      pending.reject(
        new WorkerUnavailableError("Invalid worker preview response"),
      );
      return;
    }
    pending.resolve({
      width: value.width,
      height: value.height,
      suggestedCorners: value.suggestedCorners,
    });
  }

  // Handles failure of the Python worker, cleaning up state and rejecting outstanding requests.
  private fail(error: Error): void {
    if (this.state === "failed" || this.state === "stopped") return;
    this.state = "failed";
    console.error("Python worker failed", error);
    this.rejectOutstanding(new WorkerUnavailableError(error.message));
    this.process?.kill();
  }

  // Rejects any outstanding requests to the Python worker with the given error.
  private rejectOutstanding(error: Error): void {
    clearTimeout(this.startupTimeout);
    this.readyReject?.(error);
    this.readyReject = undefined;
    this.readyResolve = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(error);
      this.pending = undefined;
    }
  }
}

/**
 * Type guard to check if a value is a valid preview result from the Python worker.
 * @param value - The value to check.
 * @returns True if the value is a valid preview result, false otherwise.
 */
function isPreviewResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & PreviewResult {
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height))
    return false;
  if ((value.width as number) <= 0 || (value.height as number) <= 0)
    return false;
  if (!value.suggestedCorners || typeof value.suggestedCorners !== "object")
    return false;
  const corners = value.suggestedCorners as Record<string, unknown>;
  return ["topLeft", "topRight", "bottomRight", "bottomLeft"].every((name) => {
    const point = corners[name];
    return (
      Array.isArray(point) &&
      point.length === 2 &&
      point.every(
        (coordinate) =>
          typeof coordinate === "number" && coordinate >= 0 && coordinate <= 1,
      )
    );
  });
}
