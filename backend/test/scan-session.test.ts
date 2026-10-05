import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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
  InvalidRotationError,
  isScanId,
  MAX_UPLOAD_BYTES,
  validateUpload,
} from "../src/scans/scan-validation.js";
import {
  STALE_SCAN_AGE_MS,
  ScanSessionService,
} from "../src/scans/scan-session-service.js";
import type { Rotation } from "../src/worker/worker-protocol.js";

// Sample PNG image buffer for testing.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const suggestedCorners = {
  topLeft: [0.04, 0.04] as [number, number],
  topRight: [0.96, 0.04] as [number, number],
  bottomRight: [0.96, 0.96] as [number, number],
  bottomLeft: [0.04, 0.96] as [number, number],
};

// Mock preview worker for testing purposes.
function previewWorker(expectedRotation: Rotation = 0) {
  return {
    async requestPreview(_originalPath: string, previewPath: string) {
      await writeFile(previewPath, "preview");
      return {
        width: 100,
        height: 200,
        suggestedCorners,
        rotation: 0 as const,
      };
    },
    async requestProcess(
      originalPath: string,
      corners: typeof suggestedCorners,
      archivePath: string,
      ocrPath: string,
      rotation: Rotation = 0,
    ) {
      assert.ok(originalPath.endsWith("original.png"));
      assert.deepEqual(corners, suggestedCorners);
      assert.equal(rotation, expectedRotation);
      await writeFile(archivePath, "archive");
      await writeFile(ocrPath, "ocr");
      return {
        width: 100,
        height: 200,
        plainText: "RECEIPT",
        ocrDurationMs: 12.5,
        rows: [
          {
            rowIndex: 0,
            segments: [{ text: "RECEIPT", x: 0 }],
            lineIndexes: [0],
          },
        ],
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
    new ScanSessionService(directory, previewWorker(90)),
    db,
    () => ({
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
    }),
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
  assert.equal(scan.rotation, 0);
  const preview = await fetch(base + scan.previewUrl);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/webp");
  assert.equal(await preview.text(), "preview");

  const processed = await fetch(base + `/api/scans/${scan.scanId}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corners: suggestedCorners, rotation: 90 }),
  });
  assert.equal(processed.status, 200);
  const result = await processed.json();
  assert.equal(result.plainText, "RECEIPT");
  assert.equal(result.lines[0].index, 0);
  assert.deepEqual(result.review.items, []);
  assert.deepEqual(result.review.warnings, ["sum_incomplete"]);
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

  const invalidRotation = await fetch(
    base + `/api/scans/${scan.scanId}/process`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corners: suggestedCorners, rotation: 45 }),
    },
  );
  assert.equal(invalidRotation.status, 400);
  assert.equal((await invalidRotation.json()).error, "invalid_rotation");

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

// Test case for verifying that the scan orientation defaults to its automatic correction and accepts a manual override.
test("scan orientation defaults to its automatic correction and accepts a manual override", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "receipt-scan-orientation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rotations: number[] = [];
  const worker = previewWorker();
  const service = new ScanSessionService(directory, {
    async requestPreview(original, preview) {
      return {
        ...(await worker.requestPreview(original, preview)),
        rotation: 90,
      };
    },
    async requestProcess(original, corners, archive, ocr, rotation) {
      rotations.push(rotation ?? 0);
      return worker.requestProcess(original, corners, archive, ocr);
    },
  });
  const scan = await service.create("image/png", png);
  assert.equal(scan.rotation, 90);
  const metadata = JSON.parse(
    await readFile(join(directory, scan.scanId, "session.json"), "utf8"),
  );
  assert.equal(metadata.rotation, 90);

  await service.process(scan.scanId, suggestedCorners);
  await service.process(scan.scanId, suggestedCorners, 180);
  await service.process(scan.scanId, suggestedCorners, 0);
  assert.deepEqual(rotations, [90, 180, 0]);
  for (const rotation of [-90, 45, 360, "90", null, true]) {
    await assert.rejects(
      service.process(scan.scanId, suggestedCorners, rotation),
      InvalidRotationError,
    );
  }
  assert.deepEqual(rotations, [90, 180, 0]);
});

// Test case for verifying that stale scan sessions are correctly cleaned up based on their modification times.
test("stale cleanup removes old complete and incomplete sessions but keeps recent changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "receipt-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scansRoot = join(root, "scans");
  const now = Date.parse("2026-10-01T12:00:00Z");
  const old = new Date(now - STALE_SCAN_AGE_MS - 1000);
  const boundary = new Date(now - STALE_SCAN_AGE_MS);
  const recent = new Date(now - STALE_SCAN_AGE_MS + 1000);
  const ids = Array.from({ length: 5 }, () => randomUUID());
  for (const id of ids) await mkdir(join(scansRoot, id), { recursive: true });
  await writeFile(join(scansRoot, ids[0], "session.json"), "{}");
  await writeFile(join(scansRoot, ids[1], "original.jpg"), "incomplete");
  await writeFile(
    join(scansRoot, ids[3], "session.json"),
    JSON.stringify({ createdAt: old.toISOString() }),
  );
  await writeFile(
    join(scansRoot, ids[3], "archive.webp"),
    "recently processed",
  );
  for (const [index, date] of [
    old,
    old,
    boundary,
    recent,
    new Date(now),
  ].entries()) {
    await utimes(join(scansRoot, ids[index]), date, date);
  }
  const archiveRoot = join(root, "receipts");
  await mkdir(archiveRoot);
  await writeFile(join(archiveRoot, "saved.webp"), "saved receipt");
  const events: { operation: string; fields: unknown }[] = [];
  const service = new ScanSessionService(
    scansRoot,
    previewWorker(),
    (_level, operation, fields) => events.push({ operation, fields }),
  );
  assert.equal(await service.cleanupStaleSessions(now), 3);
  assert.deepEqual((await readdir(scansRoot)).sort(), ids.slice(3).sort());
  assert.equal(
    await readFile(join(archiveRoot, "saved.webp"), "utf8"),
    "saved receipt",
  );
  assert.deepEqual(events, [
    {
      operation: "scan.stale_cleanup.complete",
      fields: { removedSessions: 3 },
    },
  ]);
  assert.equal(await service.cleanupStaleSessions(now), 0);
});

// Test case for verifying that stale cleanup correctly ignores non-scan directories and symbolic links.
test("stale cleanup skips foreign entries and symlinks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "receipt-stale-entries-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scansRoot = join(root, "scans");
  await mkdir(scansRoot);
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep.txt"), "keep");
  const names = ["foreign", randomUUID(), randomUUID()];
  await mkdir(join(scansRoot, names[0]));
  await writeFile(join(scansRoot, names[1]), "regular file");
  await symlink(outside, join(scansRoot, names[2]));
  const old = new Date(Date.now() - STALE_SCAN_AGE_MS - 1000);
  await utimes(join(scansRoot, names[0]), old, old);
  await utimes(join(scansRoot, names[1]), old, old);
  await utimes(outside, old, old);
  assert.equal(
    await new ScanSessionService(
      scansRoot,
      previewWorker(),
    ).cleanupStaleSessions(),
    0,
  );
  assert.deepEqual((await readdir(scansRoot)).sort(), names.sort());
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
});

// Test case for verifying that stale cleanup tolerates a missing scan directory and logs listing errors.
test("stale cleanup tolerates a missing scan directory and logs listing errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "receipt-stale-root-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events: string[] = [];
  const logger = (_level: string, operation: string) => events.push(operation);
  assert.equal(
    await new ScanSessionService(
      join(root, "missing"),
      previewWorker(),
      logger,
    ).cleanupStaleSessions(),
    0,
  );
  assert.deepEqual(events, ["scan.stale_cleanup.complete"]);
  events.length = 0;
  const file = join(root, "file");
  await writeFile(file, "not a directory");
  assert.equal(
    await new ScanSessionService(
      file,
      previewWorker(),
      logger,
    ).cleanupStaleSessions(),
    0,
  );
  assert.deepEqual(events, [
    "scan.stale_cleanup.failed",
    "scan.stale_cleanup.complete",
  ]);
});

// Test case for verifying that stale cleanup continues even when removing one session fails.
test("stale cleanup continues when removing one session fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "receipt-stale-failure-"));
  const blocked = randomUUID();
  const removable = randomUUID();
  const blockedPath = join(root, blocked);
  t.after(async () => {
    await chmod(blockedPath, 0o700);
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(blockedPath);
  await writeFile(join(blockedPath, "original.jpg"), "blocked image");
  await mkdir(join(root, removable));
  const old = new Date(Date.now() - STALE_SCAN_AGE_MS - 1000);
  await utimes(blockedPath, old, old);
  await utimes(join(root, removable), old, old);
  await chmod(blockedPath, 0);
  const events: { operation: string; scanId?: string }[] = [];
  const service = new ScanSessionService(
    root,
    previewWorker(),
    (_level, operation, fields) =>
      events.push({ operation, scanId: fields?.scanId }),
  );
  assert.equal(await service.cleanupStaleSessions(), 1);
  assert.deepEqual(await readdir(root), [blocked]);
  assert.ok(
    events.some(
      (event) =>
        event.operation === "scan.stale_cleanup.failed" &&
        event.scanId === blocked,
    ),
  );
});
