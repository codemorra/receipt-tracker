import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { errorType, silentLogger, type Logger } from "../logger.js";
import {
  isPreviewResult,
  isProcessResult,
  type Corners,
  type PreviewResult,
  type ProcessResult,
  type Rotation,
} from "./worker-protocol.js";

// Exports and types related to the Python worker protocol.
export { isRotation } from "./worker-protocol.js";
export type {
  Corner,
  Corners,
  OcrLine,
  OcrRow,
  PreviewResult,
  ProcessResult,
  Rotation,
} from "./worker-protocol.js";

export class WorkerUnavailableError extends Error {}
export class WorkerRequestError extends Error {}

// Interface for a pending request to the Python worker.
interface PendingRequest {
  requestId: string;
  complete: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// Client for interacting with the Python worker process.
export class PythonWorkerClient {
  state: "starting" | "ready" | "stopped" | "failed" = "stopped";
  private process?: ChildProcessWithoutNullStreams;
  private terminating?: ChildProcessWithoutNullStreams;
  private output = "";
  private pending?: PendingRequest;
  private queue: Promise<void> = Promise.resolve();
  private started = false;
  private generation = 0;
  private readyPromise?: Promise<void>;
  private processClosed: Promise<void> = Promise.resolve();
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private startupTimeout?: NodeJS.Timeout;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd?: string,
    private readonly logger: Logger = silentLogger,
  ) {}

  // Starts the Python worker process and returns a promise that resolves when the worker is ready.
  start(): Promise<void> {
    if (this.state === "starting" && this.readyPromise)
      return this.readyPromise;
    if (this.started && this.state !== "failed") {
      throw new Error("Worker is already started or explicitly stopped");
    }
    const recovering = this.started;
    this.started = true;
    this.state = "starting";
    this.output = "";
    const generation = ++this.generation;
    this.logger("info", recovering ? "worker.restarting" : "worker.starting");
    this.readyPromise = this.processClosed.then(() => {
      if (this.state !== "starting" || generation !== this.generation) {
        throw new WorkerUnavailableError("Worker stopped");
      }
      return new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
        try {
          const child = spawn(this.command, this.args, {
            stdio: "pipe",
            cwd: this.cwd,
          });
          this.process = child;
          this.processClosed = new Promise<void>((closed) =>
            child.once("close", closed),
          );
          const current = () =>
            generation === this.generation &&
            this.state !== "stopped" &&
            this.state !== "failed";
          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            if (current()) this.onOutput(chunk);
          });
          child.stderr.on("data", (chunk: Buffer) => {
            process.stderr.write(`[python-worker] ${chunk.toString()}`);
          });
          child.on("error", (error) => {
            if (current()) this.fail(error);
          });
          child.on("exit", (code) => {
            if (!current() || this.state === "failed") return;
            this.logger("error", "worker.exited", {
              exitCode: code ?? undefined,
            });
            this.fail(
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
    });
    return this.readyPromise;
  }

  requestPreview(
    originalPath: string,
    previewPath: string,
  ): Promise<PreviewResult> {
    return this.enqueue(() =>
      this.sendRequest(
        { type: "preview", originalPath, previewPath },
        (value) =>
          isPreviewResult(value)
            ? {
                width: value.width,
                height: value.height,
                suggestedCorners: value.suggestedCorners,
                rotation: value.rotation,
              }
            : undefined,
      ),
    );
  }

  requestProcess(
    originalPath: string,
    corners: Corners,
    archivePath: string,
    ocrPath: string,
    rotation: Rotation = 0,
  ): Promise<ProcessResult> {
    return this.enqueue(() =>
      this.sendRequest(
        {
          type: "process",
          originalPath,
          corners,
          archivePath,
          ocrPath,
          rotation,
        },
        (value) =>
          isProcessResult(value)
            ? {
                width: value.width,
                height: value.height,
                plainText: value.plainText,
                lines: value.lines,
                rows: value.rows,
                ocrDurationMs: value.ocrDurationMs,
              }
            : undefined,
      ),
    );
  }

  private enqueue<T>(send: () => Promise<T>): Promise<T> {
    const readiness =
      this.state === "failed"
        ? this.start()
        : this.state === "starting"
          ? this.readyPromise
          : undefined;
    const generation = this.generation;
    const result = Promise.all([this.queue, readiness]).then(() => {
      if (generation !== this.generation) {
        throw new WorkerUnavailableError(
          "Worker request belongs to a failed process",
        );
      }
      return send();
    });
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Stops the Python worker process.
  stop(): void {
    if (this.state === "stopped") return;
    this.state = "stopped";
    this.rejectOutstanding(new WorkerUnavailableError("Worker stopped"));
    this.terminateProcess();
  }

  private sendRequest<T>(
    request: Record<string, unknown>,
    parse: (value: Record<string, unknown>) => T | undefined,
  ): Promise<T> {
    if (this.state !== "ready" || !this.process) {
      return Promise.reject(
        new WorkerUnavailableError("Worker is unavailable"),
      );
    }

    const generation = this.generation;
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(new WorkerUnavailableError("Worker request timed out"));
      }, 60_000);
      this.pending = {
        requestId,
        complete: (value) => {
          const result = parse(value);
          if (result === undefined) throw new Error("Invalid worker response");
          resolve(result);
        },
        reject,
        timeout,
      };
      this.process!.stdin.write(
        JSON.stringify({ requestId, ...request }) + "\n",
        (error) => {
          if (error && generation === this.generation) this.fail(error);
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
      this.logger("info", "worker.ready");
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
        new WorkerRequestError(String(value.error ?? "Worker request failed")),
      );
      return;
    }
    if (value.status !== "ok") {
      pending.reject(new WorkerUnavailableError("Invalid worker response"));
      this.fail(new Error("Invalid worker response"));
      return;
    }
    try {
      pending.complete(value);
    } catch (error) {
      pending.reject(new WorkerUnavailableError("Invalid worker response"));
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Handles failure of the Python worker, cleaning up state and rejecting outstanding requests.
  private fail(error: Error): void {
    if (this.state === "failed" || this.state === "stopped") return;
    this.state = "failed";
    this.logger("error", "worker.failed", { errorType: errorType(error) });
    this.rejectOutstanding(new WorkerUnavailableError(error.message));
    this.terminateProcess();
  }

  // Terminates the Python worker process, attempting a graceful shutdown first and forcing termination if necessary.
  private terminateProcess(): void {
    const child = this.process;
    if (
      !child ||
      child.pid === undefined ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      this.terminating === child
    )
      return;
    this.terminating = child;
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        if (child.kill("SIGKILL")) {
          this.logger("warn", "worker.termination.forced", {
            signal: "SIGKILL",
          });
        }
      }
    }, 5_000);
    child.once("exit", () => clearTimeout(timeout));
    child.once("close", () => {
      clearTimeout(timeout);
      if (this.terminating === child) this.terminating = undefined;
    });
    child.kill("SIGTERM");
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
