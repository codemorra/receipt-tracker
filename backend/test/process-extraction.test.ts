import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/database.js";
import {
  InvalidLlmResponseError,
  OllamaRequestError,
  OllamaUnavailableError,
} from "../src/extraction/ollama-provider.js";
import { ScanSessionService } from "../src/scans/scan-session-service.js";

const corners = {
  topLeft: [0, 0] as [number, number],
  topRight: [1, 0] as [number, number],
  bottomRight: [1, 1] as [number, number],
  bottomLeft: [0, 1] as [number, number],
};

const ocrLine = {
  index: 0,
  text: "MILCH 1L 1,19",
  confidence: 0.95,
  box: [0, 0, 1, 0.1] as [number, number, number, number],
};

const validExtraction = {
  merchant: { rawName: "EDEKA", normalizedName: "Edeka" },
  purchaseDate: "2026-09-29",
  purchaseTime: "14:05",
  currency: "EUR",
  totalCents: 119,
  items: [
    {
      rawName: "MILCH 1L",
      normalizedName: "Milch",
      brand: null,
      productGroup: "milk",
      category: "custom",
      packageAmount: 1,
      packageUnit: "l",
      quantity: 1,
      unit: "pcs",
      unitPriceCents: 119,
      totalPriceCents: 119,
      lineType: "product",
      sourceLineIndexes: [0],
    },
  ],
  discounts: [],
};

// Tests for the process endpoint of the receipt extraction application.
test("process endpoint returns only a validated extraction using current categories", async (t) => {
  t.mock.method(console, "error", () => {});
  const directory = await mkdtemp(join(tmpdir(), "receipt-process-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { sqlite, db } = createDatabase(":memory:");
  t.after(() => sqlite.close());
  migrate(db, { migrationsFolder: "./drizzle" });

  const scans = new ScanSessionService(directory, {
    async requestPreview(_originalPath, previewPath) {
      await writeFile(previewPath, "preview");
      return { width: 100, height: 200, suggestedCorners: corners };
    },
    async requestProcess(_originalPath, _corners, archivePath, ocrPath) {
      await writeFile(archivePath, "archive");
      await writeFile(ocrPath, "ocr");
      return {
        width: 100,
        height: 200,
        plainText: ocrLine.text,
        lines: [ocrLine],
      };
    },
  });
  const scan = await scans.create(
    "image/png",
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  let nextExtraction: unknown = validExtraction;
  let nextError: Error | undefined;
  let providerCalls = 0;
  const app = createApp(scans, db, {
    async extractReceipt(input) {
      providerCalls++;
      assert.equal(input.plainText, ocrLine.text);
      assert.deepEqual(input.lines, [ocrLine]);
      assert.ok(input.categoryNames.includes("groceries"));
      assert.ok(input.categoryNames.includes("custom"));
      assert.equal(input.categoryNames.includes("food"), false);
      if (nextError) throw nextError;
      return nextExtraction;
    },
  });
  const server = app.listen(0);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  sqlite
    .prepare("UPDATE category SET name = ? WHERE name = ?")
    .run("groceries", "food");
  sqlite
    .prepare(
      "INSERT INTO category (name, created_at, updated_at) VALUES (?, ?, ?)",
    )
    .run("custom", "2026-09-29T00:00:00.000Z", "2026-09-29T00:00:00.000Z");

  const processScan = (scanId = scan.scanId) =>
    fetch(`${base}/api/scans/${scanId}/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corners }),
    });

  const missing = await processScan(randomUUID());
  assert.equal(missing.status, 404);
  assert.equal(providerCalls, 0);

  const processed = await processScan();
  assert.equal(processed.status, 200);
  const result = await processed.json();
  assert.equal(result.plainText, ocrLine.text);
  assert.equal(result.archiveUrl, `/api/scans/${scan.scanId}/archive`);
  assert.deepEqual(result.extraction, validExtraction);

  nextExtraction = {
    ...validExtraction,
    items: [{ ...validExtraction.items[0], category: "food" }],
  };
  const invalid = await processScan();
  assert.equal(invalid.status, 502);
  assert.deepEqual(await invalid.json(), { error: "invalid_extraction" });

  nextError = new OllamaUnavailableError("unavailable");
  const unavailable = await processScan();
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "ollama_unavailable" });

  nextError = new OllamaRequestError("model missing");
  const failed = await processScan();
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "ollama_failed" });

  nextError = new InvalidLlmResponseError("bad JSON");
  const malformed = await processScan();
  assert.equal(malformed.status, 502);
  assert.deepEqual(await malformed.json(), { error: "invalid_llm_response" });

  sqlite.exec("DROP TABLE category");
  const databaseFailure = await processScan();
  assert.equal(databaseFailure.status, 500);
  assert.deepEqual(await databaseFailure.json(), { error: "scan_failed" });
  assert.equal(providerCalls, 5);
});
