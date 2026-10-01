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
