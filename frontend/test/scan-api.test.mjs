import assert from "node:assert/strict";
import test from "node:test";
import {
  uploadScan,
  processScan,
  deleteScan,
  validateScanFile,
  ScanApiError,
} from "../src/api/scan-api.ts";
import {
  importReducer,
  initialImportState,
} from "../src/scans/import-state.ts";
import { rotateCorners } from "../src/scans/scan-orientation.ts";

const id = "5aa1a222-b333-4ccc-8ddd-555566667777";
const corners = {
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomRight: [1, 1],
  bottomLeft: [0, 1],
};
const scan = {
  scanId: id,
  previewUrl: `/api/scans/${id}/preview`,
  width: 400,
  height: 900,
  rotation: 90,
  suggestedCorners: corners,
};
const file = new File(["image"], "receipt.png", { type: "image/png" });
const result = {
  archiveUrl: `/api/scans/${id}/archive`,
  review: {
    scanId: id,
    archiveUrl: `/api/scans/${id}/archive`,
    merchant: {
      rawName: null,
      normalizedName: null,
      match: { status: "NEW", merchantId: null, candidates: [] },
    },
    purchaseDate: null,
    purchaseTime: null,
    currency: null,
    totalCents: null,
    items: [],
    discounts: [],
    duplicateCandidates: [],
    warnings: [],
  },
};

// Tests for the scan API, including upload, processing, and validation.
test("new import uploads raw bytes and explicitly sends the selected provider, frame, and absolute rotation", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.cache, "no-store");
    if (url === "/api/scans") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers["content-type"], "image/png");
      assert.equal(init.body, file);
      return Response.json(scan, { status: 201 });
    }
    assert.equal(url, `/api/scans/${id}/process`);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), {
      corners,
      rotation: 270,
      provider: "mistral",
    });
    return Response.json({
      ...result,
      plainText: "unneeded OCR debug output",
      timings: {},
    });
  });
  assert.deepEqual(await uploadScan(file), scan);
  assert.deepEqual(await processScan(id, corners, 270, "mistral"), result);
});

// Tests for automatic orientation and receipt boundary detection during the import workflow.
test("automatic orientation and detected receipt boundaries survive upload, manual turns, and processing", async (t) => {
  const detected = {
    topLeft: [0.2, 0.1],
    topRight: [0.75, 0.15],
    bottomRight: [0.8, 0.9],
    bottomLeft: [0.15, 0.85],
  };
  let preview;
  let expected;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/scans") return Response.json(preview, { status: 201 });
    assert.equal(url, `/api/scans/${id}/process`);
    assert.deepEqual(JSON.parse(init.body), expected);
    return Response.json(result);
  });
  for (const rotation of [0, 90, 180, 270]) {
    preview = { ...scan, rotation, suggestedCorners: detected };
    for (const turn of [0, 90, 270]) {
      let state = importReducer(initialImportState, {
        type: "uploaded",
        scan: await uploadScan(file),
      });
      assert.equal(state.rotation, rotation);
      assert.deepEqual(state.corners, detected);
      // The backend preview is already oriented, so it needs no initial CSS turn.
      assert.equal((state.rotation - state.scan.rotation + 360) % 360, 0);
      if (turn) state = importReducer(state, { type: "rotate", turn });
      expected = {
        provider: "ollama",
        rotation: (rotation + turn) % 360,
        corners: rotateCorners(detected, turn),
      };
      assert.equal((state.rotation - state.scan.rotation + 360) % 360, turn);
      await processScan(id, state.corners, state.rotation, "ollama");
    }
  }
});

// Tests for file validation, including unsupported types, empty files, and large images.
test("unsupported and empty files are rejected while large images have no frontend size limit", async (t) => {
  t.mock.method(globalThis, "fetch", () => {
    assert.fail("must not send invalid files");
  });
  for (const [input, code] of [
    [{ type: "application/pdf", size: 1 }, "unsupported_type"],
    [{ type: "image/png", size: 0 }, "invalid_upload"],
  ]) {
    assert.throws(() => validateScanFile(input), { code });
  }
  for (const size of [20 * 1024 * 1024 + 1, Number.MAX_SAFE_INTEGER]) {
    assert.doesNotThrow(() => validateScanFile({ type: "image/jpeg", size }));
  }
  await assert.rejects(
    uploadScan(new File([], "empty.png", { type: "image/png" })),
    { code: "invalid_upload" },
  );
});

// Tests for handling malformed scan responses, including invalid frames, dimensions, rotation, IDs, and foreign image URLs.
test("scan responses reject malformed frames, dimensions, rotation, IDs, and foreign image URLs", async (t) => {
  let payload = scan;
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  for (const change of [
    { width: 0 },
    { rotation: 45 },
    { scanId: "../../escape" },
    { previewUrl: "https://foreign.example/image" },
    { suggestedCorners: { ...corners, topLeft: [2, 0] } },
  ]) {
    payload = { ...scan, ...change };
    await assert.rejects(uploadScan(file), { code: "unexpected_response" });
  }
  for (const change of [
    { archiveUrl: "https://foreign.example/image" },
    { review: { ...result.review, scanId: "other" } },
    { review: { ...result.review, items: null } },
    {
      review: {
        ...result.review,
        merchant: { ...result.review.merchant, match: null },
      },
    },
    { review: { ...result.review, totalCents: "invalid" } },
    {
      review: { ...result.review, archiveUrl: "https://foreign.example/image" },
    },
  ]) {
    payload = { ...result, ...change };
    await assert.rejects(processScan(id, corners, 0, "ollama"), {
      code: "unexpected_response",
    });
  }
});

// Tests for cancelling scans, including handling already missing scans and sanitizing HTTP, network, and malformed response errors.
test("cancel accepts an already missing scan and sanitizes HTTP, network, and malformed response errors", async (t) => {
  let response = () => new Response(null, { status: 204 });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, `/api/scans/${id}`);
    assert.equal(init.method, "DELETE");
    return response();
  });
  await deleteScan(id);
  response = () => Response.json({ error: "scan_not_found" }, { status: 404 });
  await deleteScan(id);
  for (const [next, expected] of [
    [
      () =>
        Response.json(
          { error: "scan_cancel_failed", details: "private backend details" },
          { status: 500 },
        ),
      "scan_cancel_failed",
    ],
    [
      () => new Response("private backend details", { status: 502 }),
      "unexpected_response",
    ],
    [
      () => {
        throw new Error("private backend details");
      },
      "network_error",
    ],
  ]) {
    response = next;
    await assert.rejects(deleteScan(id), (error) => {
      assert.ok(error instanceof ScanApiError);
      assert.equal(error.code, expected);
      assert.equal(String(error).includes("private backend details"), false);
      return true;
    });
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(deleteScan(id, controller.signal), {
    name: "AbortError",
  });
});
