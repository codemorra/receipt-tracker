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
  LlmRequestError,
  LlmUnavailableError,
} from "../src/extraction/extraction-errors.js";
import type { ReceiptExtractionDiagnostics } from "../src/extraction/receipt-extraction-provider.js";
import { createProviderResolver } from "../src/extraction/provider-resolver.js";
import { ProviderSettingsService } from "../src/settings/provider-settings-service.js";
import { SecretStorage } from "../src/settings/secret-storage.js";
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
  merchant: { rawName: "TEST MARKET", normalizedName: "Test Market" },
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
test("process endpoint returns a review DTO using current categories and database matches", async (t) => {
  t.mock.method(console, "error", () => {});
  const directory = await mkdtemp(join(tmpdir(), "receipt-process-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { sqlite, db } = createDatabase(":memory:");
  t.after(() => sqlite.close());
  migrate(db, { migrationsFolder: "./drizzle" });

  let workerCalls = 0;
  const scans = new ScanSessionService(directory, {
    async requestPreview(_originalPath, previewPath) {
      await writeFile(previewPath, "preview");
      return {
        width: 100,
        height: 200,
        suggestedCorners: corners,
        rotation: 0,
      };
    },
    async requestProcess(_originalPath, _corners, archivePath, ocrPath) {
      workerCalls++;
      await writeFile(archivePath, "archive");
      await writeFile(ocrPath, "ocr");
      return {
        width: 100,
        height: 200,
        plainText: ocrLine.text,
        ocrDurationMs: 12.5,
        rows: [
          {
            rowIndex: 0,
            segments: [{ text: ocrLine.text, x: 0 }],
            lineIndexes: [0],
          },
        ],
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
  const nextDiagnostics: ReceiptExtractionDiagnostics = {
    provider: "ollama",
    model: "test-model",
    inputTokens: 250,
    ollama: { model: "test-model", promptEvalCount: 250 },
  };
  let providerCalls = 0;
  const events: string[] = [];
  const settings = new ProviderSettingsService(
    db,
    new SecretStorage(join(directory, "keys")),
  );
  settings.updateProvider("ollama", { enabled: true, model: "test-model" });
  settings.updateProvider("openai", {
    enabled: true,
    model: "cloud-model",
    apiKey: { action: "set", value: "secret-external-key" },
  });
  settings.setDefaultProvider("ollama");
  const selectedProviders: string[] = [];
  const app = createApp(
    scans,
    db,
    createProviderResolver(settings, (configuration) => ({
      async extractReceipt(input, onDiagnostics) {
        selectedProviders.push(configuration.provider);
        providerCalls++;
        assert.equal(input.plainText, ocrLine.text);
        assert.deepEqual(input.lines, [ocrLine]);
        assert.deepEqual(input.rows, [
          {
            rowIndex: 0,
            segments: [{ text: ocrLine.text, x: 0 }],
            lineIndexes: [0],
          },
        ]);
        assert.ok(input.categoryNames.includes("groceries"));
        assert.ok(input.categoryNames.includes("custom"));
        assert.equal(input.categoryNames.includes("food"), false);
        if (nextError) throw nextError;
        onDiagnostics?.({
          ...nextDiagnostics,
          provider: configuration.provider,
          model: configuration.model,
          ollama:
            configuration.provider === "ollama"
              ? nextDiagnostics.ollama
              : undefined,
        });
        return nextExtraction;
      },
    })),
    directory,
    (level, operation, fields) => {
      events.push(JSON.stringify({ level, operation, fields }));
    },
    settings,
  );
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

  const now = "2026-09-29T00:00:00.000Z";
  const merchantId = Number(
    sqlite
      .prepare(
        "INSERT INTO merchant (name, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .run("Test Market", now, now).lastInsertRowid,
  );
  sqlite
    .prepare(
      "INSERT INTO merchant_alias (merchant_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(merchantId, "TEST MARKET", "test market", now);
  const categoryId = (
    sqlite.prepare("SELECT id FROM category WHERE name = ?").get("custom") as {
      id: number;
    }
  ).id;
  const groupId = Number(
    sqlite
      .prepare(
        "INSERT INTO product_group (category_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(categoryId, "milk", now, now).lastInsertRowid,
  );
  const productId = Number(
    sqlite
      .prepare(
        "INSERT INTO product (product_group_id, name, package_amount, package_unit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(groupId, "Milch", 1000, "ml", now, now).lastInsertRowid,
  );
  sqlite
    .prepare(
      "INSERT INTO product_alias (product_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(productId, "MILCH 1L", "milch 1 l", now);
  const receiptId = Number(
    sqlite
      .prepare(
        "INSERT INTO receipt (merchant_id, purchase_date, purchase_time, total_cents, currency, image_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        merchantId,
        "2026-09-29",
        "14:05",
        119,
        "EUR",
        "receipts/existing.webp",
        now,
        now,
      ).lastInsertRowid,
  );
  sqlite
    .prepare(
      "INSERT INTO receipt_item (receipt_id, position, raw_name, quantity, unit, total_price_cents, line_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(receiptId, 0, "MILCH 1L", 1, "pcs", 119, "product", now, now);

  const processScan = (scanId = scan.scanId, provider?: unknown) =>
    fetch(`${base}/api/scans/${scanId}/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corners, provider }),
    });

  const missing = await processScan(randomUUID());
  assert.equal(missing.status, 404);
  assert.equal(providerCalls, 0);

  const processed = await processScan();
  assert.equal(processed.status, 200);
  const result = await processed.json();
  assert.equal(result.plainText, ocrLine.text);
  assert.equal(result.archiveUrl, `/api/scans/${scan.scanId}/archive`);
  assert.equal(result.extraction, undefined);
  assert.equal(result.timings.ocrDurationMs, 12.5);
  assert.ok(result.timings.workerDurationMs >= 0);
  assert.ok(result.timings.llmDurationMs >= 0);
  assert.ok(result.timings.totalDurationMs >= result.timings.workerDurationMs);
  assert.ok(result.timings.totalDurationMs >= result.timings.llmDurationMs);
  assert.deepEqual(result.timings.ollama, {
    model: "test-model",
    promptEvalCount: 250,
  });
  assert.deepEqual(result.timings.llm, nextDiagnostics);
  assert.equal(result.review.scanId, scan.scanId);
  assert.equal(result.review.archiveUrl, result.archiveUrl);
  assert.deepEqual(result.review.merchant, {
    ...validExtraction.merchant,
    match: {
      status: "MATCHED",
      merchantId,
      candidates: [{ merchantId, name: "Test Market" }],
    },
  });
  assert.equal(result.review.items[0].match.status, "MATCHED");
  assert.equal(result.review.items[0].match.productId, productId);
  assert.deepEqual(result.review.items[0].sourceLineIndexes, [0]);
  assert.deepEqual(
    result.review.duplicateCandidates.map(
      (candidate: { receiptId: number }) => candidate.receiptId,
    ),
    [receiptId],
  );
  assert.equal(
    result.review.duplicateCandidates[0].imagePath,
    "receipts/existing.webp",
  );
  assert.equal(
    result.review.duplicateCandidates[0].items[0].rawName,
    "MILCH 1L",
  );
  assert.deepEqual(result.review.sumCheck, {
    status: "MATCH",
    itemSumCents: 119,
    discountSumCents: 0,
    differenceCents: 0,
  });
  assert.deepEqual(result.review.warnings, ["possible_duplicate"]);

  const callsBeforeInvalidSelection = workerCalls;
  for (const provider of ["unknown", null, "", 123]) {
    const invalidProvider = await processScan(scan.scanId, provider);
    assert.equal(invalidProvider.status, 400);
    assert.deepEqual(await invalidProvider.json(), {
      error: "invalid_provider",
    });
  }
  settings.updateProvider("openai", { enabled: false });
  const disabledProvider = await processScan(scan.scanId, "openai");
  assert.equal(disabledProvider.status, 409);
  assert.deepEqual(await disabledProvider.json(), {
    error: "provider_disabled",
  });
  settings.setDefaultProvider(null);
  const missingDefault = await processScan();
  assert.equal(missingDefault.status, 409);
  assert.deepEqual(await missingDefault.json(), {
    error: "default_provider_missing",
  });
  assert.equal(workerCalls, callsBeforeInvalidSelection);
  settings.updateProvider("openai", { enabled: true });
  const explicit = await processScan(scan.scanId, "openai");
  assert.equal(explicit.status, 200);
  assert.equal(selectedProviders.at(-1), "openai");
  assert.equal((await explicit.json()).timings.llm.provider, "openai");
  settings.setDefaultProvider("ollama");

  nextExtraction = { ...validExtraction, totalCents: 130 };
  const mismatched = await processScan();
  assert.equal(mismatched.status, 200);
  const mismatchReview = (await mismatched.json()).review;
  assert.equal(mismatchReview.sumCheck.status, "MISMATCH");
  assert.deepEqual(mismatchReview.duplicateCandidates, []);
  assert.deepEqual(mismatchReview.warnings, ["sum_mismatch"]);

  nextExtraction = {
    ...validExtraction,
    merchant: { rawName: "Unknown", normalizedName: "Unknown" },
    totalCents: null,
  };
  const incomplete = await processScan();
  assert.equal(incomplete.status, 200);
  const incompleteReview = (await incomplete.json()).review;
  assert.equal(incompleteReview.merchant.match.status, "NEW");
  assert.deepEqual(incompleteReview.duplicateCandidates, []);
  assert.deepEqual(incompleteReview.warnings, ["sum_incomplete"]);

  nextExtraction = {
    ...validExtraction,
    items: [{ ...validExtraction.items[0], lineType: "deposit" }],
  };
  const nonProduct = await processScan();
  assert.equal(nonProduct.status, 200);
  assert.equal((await nonProduct.json()).review.items[0].match, null);

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

  nextError = new OllamaRequestError("private receipt text");
  const failed = await processScan();
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: "ollama_failed" });

  nextError = new InvalidLlmResponseError("bad JSON");
  const malformed = await processScan();
  assert.equal(malformed.status, 502);
  assert.deepEqual(await malformed.json(), { error: "invalid_llm_response" });

  nextError = new LlmUnavailableError("openai", "secret-external-key");
  const externalUnavailable = await processScan(scan.scanId, "openai");
  assert.equal(externalUnavailable.status, 503);
  assert.deepEqual(await externalUnavailable.json(), {
    error: "llm_unavailable",
  });

  nextError = new LlmRequestError("openai", "secret-external-key", 401);
  const externalFailed = await processScan(scan.scanId, "openai");
  assert.equal(externalFailed.status, 502);
  assert.deepEqual(await externalFailed.json(), {
    error: "provider_authentication_failed",
  });
  nextError = new LlmRequestError("openai", "secret-external-key", 403);
  settings.updateProvider("openai", { enabled: true });
  const forbidden = await processScan(scan.scanId, "openai");
  assert.equal(forbidden.status, 502);
  assert.deepEqual(await forbidden.json(), {
    error: "provider_authentication_failed",
  });

  assert.ok(
    events.some((event) => {
      const entry = JSON.parse(event);
      return (
        entry.operation === "scan.llm.complete" &&
        entry.fields.provider === nextDiagnostics.provider &&
        entry.fields.model === nextDiagnostics.model &&
        entry.fields.inputTokens === nextDiagnostics.inputTokens
      );
    }),
  );
  assert.ok(
    events.some((event) => {
      const entry = JSON.parse(event);
      return (
        entry.operation === "scan.llm.failed" &&
        entry.fields.provider === "openai" &&
        entry.fields.httpStatus === 401
      );
    }),
  );
  nextError = undefined;
  nextExtraction = validExtraction;

  sqlite.exec("DROP TABLE merchant_alias");
  const databaseFailure = await processScan();
  assert.equal(databaseFailure.status, 500);
  assert.deepEqual(await databaseFailure.json(), { error: "scan_failed" });
  assert.ok(
    events.some((event) => event.includes('"operation":"scan.ocr.complete"')),
  );
  assert.ok(
    events.some((event) => event.includes('"operation":"scan.process.failed"')),
  );
  for (const sensitive of [
    ocrLine.text,
    validExtraction.items[0].rawName,
    JSON.stringify(validExtraction),
    "private receipt text",
    "secret-external-key",
  ]) {
    assert.equal(events.join("\n").includes(sensitive), false);
  }
});
