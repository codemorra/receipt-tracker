import type { Corners } from "./ReceiptImagePreview";

// Utilities for handling scan orientation and rotating receipt corners.
export type Rotation = 0 | 90 | 180 | 270;

// Adds a rotation to the current rotation, ensuring the result stays within 0-359 degrees.
export function addRotation(rotation: Rotation, turn: Rotation): Rotation {
  return ((rotation + turn) % 360) as Rotation;
}

/**
 * Rotates the corners of a receipt according to the specified rotation.
 *
 * Args:
 *   corners (Corners): The original corners of the receipt.
 *   rotation (Rotation): The rotation to apply.
 *
 * Returns:
 *   Corners: The rotated corners of the receipt.
 */
export function rotateCorners(corners: Corners, rotation: Rotation): Corners {
  for (let turn = 0; turn < rotation / 90; turn++) {
    corners = {
      topLeft: [1 - corners.bottomLeft[1], corners.bottomLeft[0]],
      topRight: [1 - corners.topLeft[1], corners.topLeft[0]],
      bottomRight: [1 - corners.topRight[1], corners.topRight[0]],
      bottomLeft: [1 - corners.bottomRight[1], corners.bottomRight[0]],
    };
  }
  return corners;
}
