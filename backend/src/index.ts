import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendLifecycle } from "./startup.js";
import { createApp } from "./app.js";
import { createDatabase } from "./db/database.js";
import { createReceiptExtractionProviderFromEnv } from "./extraction/create-provider.js";
import {
  createFileLogger,
  errorType,
  silentLogger,
  type Logger,
} from "./logger.js";
import { PythonWorkerClient } from "./worker/python-worker-client.js";
import { ScanSessionService } from "./scans/scan-session-service.js";

// Determine the project root directory based on the current file location.
const projectRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);

// Determine the Python executable path for the worker.
const python =
  process.env.PYTHON_EXECUTABLE ??
  resolve(projectRoot, "python_worker/.venv/bin/python");

// Determine the root directory for storing scan data.
const scansRoot = process.env.SCANS_DIR ?? resolve(projectRoot, "data/scans");

// Determine the log file path.
const logFile =
  process.env.LOG_FILE ?? resolve(projectRoot, "data/logs/backend.log");

let logger: Logger = silentLogger;
let startupPhase = "logging";

// Initialize the logger and track the startup phase.
try {
  logger = createFileLogger(logFile);
  logger("info", "backend.starting");
  startupPhase = "configuration";
  const provider = createReceiptExtractionProviderFromEnv();
  startupPhase = "database migration";
  const { db, sqlite } = createDatabase();
  logger("info", "database.ready");
  startupPhase = "application setup";

  // Create the Python worker client and scan session service.
  const worker = new PythonWorkerClient(
    python,
    ["-m", "python_worker.worker"],
    projectRoot,
    logger,
  );
  const scans = new ScanSessionService(scansRoot, worker, logger);
  const app = createApp(
    scans,
    db,
    provider,
    resolve(projectRoot, "data"),
    logger,
  );
  const port = Number(process.env.PORT ?? 3000);

  startupPhase = "scan cleanup";
  await scans.cleanupStaleSessions();

  // Create the backend lifecycle manager, which controls the worker, HTTP server, and database connection.
  const lifecycle = createBackendLifecycle(
    worker,
    () => app.listen(port),
    () => sqlite.close(),
  );
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      logger("info", "backend.stopping", { signal });
      lifecycle.stop();
    });
  }
  startupPhase = "worker readiness and HTTP startup";
  if (await lifecycle.start()) {
    logger("info", "backend.listening", { port });
    console.log(`Backend listening on http://localhost:${port}`);
  }
} catch (error) {
  logger("error", "backend.start.failed", {
    phase: startupPhase,
    errorType: errorType(error),
  });
  console.error(
    `Backend startup failed during ${startupPhase}`,
    errorType(error),
  );
  process.exitCode = 1;
}
