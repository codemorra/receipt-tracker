import assert from "node:assert/strict";
import test from "node:test";
import { addRotation, rotateCorners } from "../src/scans/scan-orientation.ts";

const corners = {
  topLeft: [0.1, 0.2],
  topRight: [0.8, 0.15],
  bottomRight: [0.85, 0.9],
  bottomLeft: [0.2, 0.8],
};

// Test suite for verifying the behavior of scan orientation utilities.
function assertCorners(actual, expected) {
  for (const name of Object.keys(expected)) {
    for (let axis = 0; axis < 2; axis++) {
      assert.ok(Math.abs(actual[name][axis] - expected[name][axis]) < 1e-10);
    }
  }
}

// Helper function to assert that two sets of corners are approximately equal.
test("turning right preserves the adjusted receipt frame in the rotated image", () => {
  const original = structuredClone(corners);
  assertCorners(rotateCorners(corners, 90), {
    topLeft: [0.2, 0.2],
    topRight: [0.8, 0.1],
    bottomRight: [0.85, 0.8],
    bottomLeft: [0.1, 0.85],
  });
  assert.deepEqual(corners, original);
});

// Test case for verifying that turning right preserves the adjusted receipt frame in the rotated image.
test("turning left and reversing a turn preserve the adjusted frame", () => {
  assertCorners(rotateCorners(corners, 270), {
    topLeft: [0.15, 0.2],
    topRight: [0.9, 0.15],
    bottomRight: [0.8, 0.8],
    bottomLeft: [0.2, 0.9],
  });
  assertCorners(rotateCorners(rotateCorners(corners, 90), 270), corners);
  assertCorners(rotateCorners(corners, 0), corners);
  assertCorners(rotateCorners(rotateCorners(corners, 180), 180), corners);
});

// Test case for verifying that a full image selection stays at the image edges in all directions.
test("a full image selection stays at the image edges in all directions", () => {
  const full = {
    topLeft: [0, 0],
    topRight: [1, 0],
    bottomRight: [1, 1],
    bottomLeft: [0, 1],
  };
  for (const rotation of [0, 90, 180, 270]) {
    assert.deepEqual(rotateCorners(full, rotation), full);
  }
});

// Test case for verifying that manual turns compose correctly with the automatic correction.
test("manual turns compose with the automatic correction", () => {
  assert.equal(addRotation(90, 90), 180);
  assert.equal(addRotation(90, 270), 0);
  assert.equal(addRotation(270, 90), 0);
  let rotation = 90;
  for (let turn = 0; turn < 4; turn++) rotation = addRotation(rotation, 90);
  assert.equal(rotation, 90);
});

test("reprocessing discards the complete previous extraction before the request and never restores it after failure", async () => {
  const { importReducer, initialImportState } =
    await import("../src/scans/import-state.ts");
  const scan = {
    scanId: "scan",
    previewUrl: "/preview",
    width: 400,
    height: 900,
    suggestedCorners: corners,
    rotation: 90,
  };
  const oldResult = {
    archiveUrl: "/old",
    review: { items: [{ rawName: "old" }] },
  };
  let state = importReducer(initialImportState, { type: "uploaded", scan });
  state = importReducer(state, { type: "processed", result: oldResult });
  const processing = importReducer(state, {
    type: "start",
    operation: "process",
  });
  assert.equal(processing.processed, null);
  assert.equal(processing.generation, state.generation + 1);
  assert.equal(processing.scan, scan);
  assert.equal(processing.corners, corners);
  assert.equal(processing.rotation, 90);
  const failed = importReducer(processing, { type: "settled" });
  assert.equal(failed.processed, null);
  assert.equal(failed.busy, null);
  const replacement = {
    archiveUrl: "/new",
    review: { items: [{ rawName: "new" }] },
  };
  const completed = importReducer(failed, {
    type: "processed",
    result: replacement,
  });
  assert.deepEqual(completed.processed, replacement);
  assert.equal(
    completed.processed.review.items.some((item) => item.rawName === "old"),
    false,
  );
});

test("frame edits invalidate the review, preserve orientation, and are ignored during processing", async () => {
  const { importReducer, initialImportState } =
    await import("../src/scans/import-state.ts");
  const scan = {
    scanId: "scan",
    previewUrl: "/preview",
    width: 400,
    height: 900,
    suggestedCorners: corners,
    rotation: 90,
  };
  const ready = importReducer(
    importReducer(initialImportState, { type: "uploaded", scan }),
    { type: "processed", result: { archiveUrl: "/archive", review: {} } },
  );
  const rotated = importReducer(ready, { type: "rotate", turn: 270 });
  assert.equal(rotated.rotation, 0);
  assertCorners(rotated.corners, rotateCorners(corners, 270));
  assert.equal(rotated.processed, null);
  assert.equal(rotated.generation, ready.generation + 1);
  const adjusted = importReducer(ready, {
    type: "corners",
    corners: { ...corners, topLeft: [0.2, 0.2] },
  });
  assert.equal(adjusted.processed, null);
  assert.equal(adjusted.rotation, 90);
  const pending = importReducer(ready, { type: "start", operation: "process" });
  assert.equal(importReducer(pending, { type: "rotate", turn: 90 }), pending);
  assert.equal(importReducer(pending, { type: "corners", corners }), pending);
  const reset = importReducer(ready, { type: "reset" });
  assert.equal(reset.scan, null);
  assert.equal(reset.processed, null);
  assert.equal(reset.corners, null);
  assert.equal(reset.rotation, 0);
  assert.equal(reset.generation, ready.generation + 1);
});

test("receipt-only restores detected boundaries in the current orientation and invalidates the review", async () => {
  const { importReducer, initialImportState } =
    await import("../src/scans/import-state.ts");
  const scan = {
    scanId: "scan",
    suggestedCorners: structuredClone(corners),
    rotation: 90,
  };
  assert.equal(
    importReducer(initialImportState, { type: "receipt-frame" }),
    initialImportState,
  );
  for (const turn of [0, 90, 180, 270]) {
    let state = importReducer(initialImportState, { type: "uploaded", scan });
    state = importReducer(state, { type: "rotate", turn });
    state = importReducer(state, {
      type: "corners",
      corners: {
        topLeft: [0, 0],
        topRight: [1, 0],
        bottomRight: [1, 1],
        bottomLeft: [0, 1],
      },
    });
    state = importReducer(state, {
      type: "processed",
      result: { archiveUrl: "/archive", review: {} },
    });
    const restored = importReducer(state, { type: "receipt-frame" });
    assertCorners(restored.corners, rotateCorners(corners, turn));
    assert.equal(restored.rotation, state.rotation);
    assert.equal(restored.processed, null);
    assert.equal(restored.generation, state.generation + 1);
    const pending = importReducer(state, {
      type: "start",
      operation: "process",
    });
    assert.equal(importReducer(pending, { type: "receipt-frame" }), pending);
  }
  assert.deepEqual(scan.suggestedCorners, corners);
});

test("import preselects only a selectable default, preserves explicit choices, and never falls back", async () => {
  const { resolveImportProvider } =
    await import("../src/scans/import-state.ts");
  const settings = {
    defaultProvider: "ollama",
    providers: [
      { provider: "ollama", selectable: true },
      { provider: "openai", selectable: true },
    ],
  };
  assert.equal(resolveImportProvider(settings, undefined), "ollama");
  assert.equal(resolveImportProvider(settings, "openai"), "openai");
  assert.equal(resolveImportProvider(settings, null), null);
  assert.equal(
    resolveImportProvider(
      {
        ...settings,
        providers: settings.providers.map((provider) => ({
          ...provider,
          selectable: provider.provider === "ollama",
        })),
      },
      "openai",
    ),
    null,
  );
  assert.equal(resolveImportProvider(null, "openai"), null);
  const unavailable = {
    ...settings,
    providers: settings.providers.map((provider) => ({
      ...provider,
      selectable: provider.provider === "openai",
    })),
  };
  assert.equal(resolveImportProvider(unavailable, undefined), null);
  assert.equal(resolveImportProvider(unavailable, "ollama"), null);
  assert.equal(
    resolveImportProvider({ ...settings, defaultProvider: null }, undefined),
    null,
  );
});
