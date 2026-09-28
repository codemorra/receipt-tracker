import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { PythonWorkerClient } from "./worker/python-worker-client.js";
import { ScanSessionService } from "./scans/scan-session-service.js";

const projectRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);
const python =
  process.env.PYTHON_EXECUTABLE ??
  resolve(projectRoot, "python-worker/.venv/bin/python");
const script = resolve(projectRoot, "python-worker/worker.py");
const scansRoot = process.env.SCANS_DIR ?? resolve(projectRoot, "data/scans");
const worker = new PythonWorkerClient(python, [script]);
const scans = new ScanSessionService(scansRoot, worker);
const app = createApp(scans);
const port = Number(process.env.PORT ?? 3000);

void worker.start().catch((error) => {
  console.error("Python worker failed to start", error);
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

process.once("SIGTERM", () => worker.stop());
process.once("SIGINT", () => worker.stop());
