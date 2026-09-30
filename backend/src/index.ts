import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createDatabase } from "./db/database.js";
import { createOllamaProviderFromEnv } from "./extraction/ollama-provider.js";
import { PythonWorkerClient } from "./worker/python-worker-client.js";
import { ScanSessionService } from "./scans/scan-session-service.js";

// Determine the project root directory and configure paths for the Python worker and scans.
const projectRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);
const python =
  process.env.PYTHON_EXECUTABLE ??
  resolve(projectRoot, "python_worker/.venv/bin/python");
const scansRoot = process.env.SCANS_DIR ?? resolve(projectRoot, "data/scans");
const worker = new PythonWorkerClient(
  python,
  ["-m", "python_worker.worker"],
  projectRoot,
);
const scans = new ScanSessionService(scansRoot, worker);
const provider = createOllamaProviderFromEnv();
try {
  const { db, sqlite } = createDatabase();
  const app = createApp(scans, db, provider, resolve(projectRoot, "data"));
  const port = Number(process.env.PORT ?? 3000);

  void worker.start().catch((error) => {
    console.error("Python worker failed to start", error);
  });

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });

  process.once("SIGTERM", () => {
    worker.stop();
    sqlite.close();
  });
  process.once("SIGINT", () => {
    worker.stop();
    sqlite.close();
  });
} catch (error) {
  console.error("Backend startup failed during database migration", error);
  process.exitCode = 1;
}
