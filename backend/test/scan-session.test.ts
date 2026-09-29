import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/app.js";
import {
  WorkerRequestError,
  WorkerUnavailableError,
} from "../src/worker/python-worker-client.js";
import {
  isScanId,
  MAX_UPLOAD_BYTES,
  ScanSessionService,
  validateUpload,
} from "../src/scans/scan-session-service.js";

// Sample PNG image buffer for testing.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const suggestedCorners = {
  topLeft: [0.04, 0.04] as [number, number],
  topRight: [0.96, 0.04] as [number, number],
  bottomRight: [0.96, 0.96] as [number, number],
  bottomLeft: [0.04, 0.96] as [number, number],
};

// Mock preview worker for testing purposes.
function previewWorker() {
  return {
    async requestPreview(_originalPath: string, previewPath: string) {
      await writeFile(previewPath, "preview");
      return { width: 100, height: 200, suggestedCorners };
    },
    async requestProcess(
      originalPath: string,
      corners: typeof suggestedCorners,
      archivePath: string,
      ocrPath: string,
    ) {
      assert.ok(originalPath.endsWith("original.png"));
      assert.deepEqual(corners, suggestedCorners);
      await writeFile(archivePath, "archive");
      await writeFile(ocrPath, "ocr");
      return {
        width: 100,
        height: 200,
        plainText: "RECEIPT",
        lines: [
          {
            index: 0,
            text: "RECEIPT",
            confidence: 0.95,
            box: [0, 0, 1, 1] as [number, number, number, number],
          },
        ],
      };
    },
  };
}

// Test for creating a scan session and verifying stored files and metadata.
test("scan sessions store the original, preview, and session metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-scans-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new ScanSessionService(directory, previewWorker());

  const scan = await service.create("image/png", png);
  assert.ok(isScanId(scan.scanId));
  assert.equal(scan.previewUrl, "/api/scans/" + scan.scanId + "/preview");
  assert.deepEqual(scan.suggestedCorners, suggestedCorners);
  assert.deepEqual(
    await readFile(join(directory, scan.scanId, "original.png")),
    png,
  );
  assert.equal(
    await service.previewPath(scan.scanId),
    join(directory, scan.scanId, "preview.webp"),
  );
  const metadata = JSON.parse(
    await readFile(join(directory, scan.scanId, "session.json"), "utf8"),
  );
  assert.equal(metadata.scanId, scan.scanId);
  assert.equal(metadata.originalName, "original.png");
  assert.equal(metadata.previewName, "preview.webp");
  assert.ok(metadata.createdAt);
  assert.equal(await service.previewPath("../invalid"), undefined);
});

// Test for validating that invalid uploads are rejected before a scan session is created.
test("invalid uploads are rejected before a scan is created", async () => {
  assert.throws(() => validateUpload("text/plain", png), { status: 415 });
  assert.throws(() => validateUpload("image/png", Buffer.alloc(0)), {
    status: 400,
  });
  assert.throws(() => validateUpload("image/jpeg", png), { status: 400 });
  assert.throws(
    () => validateUpload("image/png", Buffer.alloc(MAX_UPLOAD_BYTES + 1)),
    { status: 413 },
  );
});

// Test for ensuring that failed preview processing removes the temporary session directory.
test("failed preview processing removes the temporary session", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-scans-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new ScanSessionService(directory, {
    async requestPreview() {
      throw new WorkerUnavailableError("stopped");
    },
    async requestProcess() {
      throw new WorkerUnavailableError("stopped");
    },
  });

  await assert.rejects(
    service.create("image/png", png),
    WorkerUnavailableError,
  );
  assert.deepEqual(await readdir(directory), []);
});

// Test for the scan API, verifying session creation and preview serving.
test("scan API creates a session and serves its preview", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-scans-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { sqlite, db } = createDatabase(":memory:");
  t.after(() => sqlite.close());
  migrate(db, { migrationsFolder: "./drizzle" });
  const app = createApp(
    new ScanSessionService(directory, previewWorker()),
    db,
    {
      async extractReceipt() {
        return {
          merchant: { rawName: null, normalizedName: null },
          purchaseDate: null,
          purchaseTime: null,
          currency: null,
          totalCents: null,
          items: [],
          discounts: [],
        };
      },
    },
  );
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;

  const upload = await fetch(base + "/api/scans", {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: png,
  });
  assert.equal(upload.status, 201);
  const scan = await upload.json();
  const preview = await fetch(base + scan.previewUrl);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/webp");
  assert.equal(await preview.text(), "preview");

  const processed = await fetch(base + `/api/scans/${scan.scanId}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corners: suggestedCorners }),
  });
  assert.equal(processed.status, 200);
  const result = await processed.json();
  assert.equal(result.plainText, "RECEIPT");
  assert.equal(result.lines[0].index, 0);
  assert.deepEqual(result.extraction.items, []);
  const archive = await fetch(base + result.archiveUrl);
  assert.equal(archive.status, 200);
  assert.equal(archive.headers.get("content-type"), "image/webp");
  assert.equal(await archive.text(), "archive");

  const invalidCorners = await fetch(
    base + `/api/scans/${scan.scanId}/process`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corners: { topLeft: [0, 0] } }),
    },
  );
  assert.equal(invalidCorners.status, 400);
  assert.equal((await invalidCorners.json()).error, "invalid_corners");

  const missing = await fetch(base + `/api/scans/${randomUUID()}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corners: suggestedCorners }),
  });
  assert.equal(missing.status, 404);

  const invalid = await fetch(base + "/api/scans", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: png,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "invalid_upload");
});

// Test for failed reprocessing scenario
test("failed reprocessing keeps the previous archive and removes temporary files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-scans-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const service = new ScanSessionService(directory, previewWorker());
  const scan = await service.create("image/png", png);
  await service.process(scan.scanId, suggestedCorners);

  const failing = new ScanSessionService(directory, {
    ...previewWorker(),
    async requestProcess(_originalPath, _corners, archivePath) {
      await writeFile(archivePath, "incomplete");
      throw new WorkerRequestError("OCR failed");
    },
  });
  await assert.rejects(
    failing.process(scan.scanId, suggestedCorners),
    WorkerRequestError,
  );
  assert.equal(
    await readFile(join(directory, scan.scanId, "archive.webp"), "utf8"),
    "archive",
  );
  assert.deepEqual((await readdir(join(directory, scan.scanId))).sort(), [
    "archive.webp",
    "ocr.webp",
    "original.png",
    "preview.webp",
    "session.json",
  ]);
});
