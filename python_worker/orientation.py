import math
import sys
from contextlib import redirect_stdout
from functools import cache

import numpy
from PIL import Image


@cache
def initialize_orientation():
    """Initialize the orientation model.

    Returns:
        DocImgOrientationClassification or None: The initialized orientation model, or None if initialization failed.
    """
    try:
        with redirect_stdout(sys.stderr):
            from paddleocr import (  # type: ignore[import-untyped]
                DocImgOrientationClassification,
            )

            return DocImgOrientationClassification(
                model_name="PP-LCNet_x1_0_doc_ori", device="cpu", enable_hpi=True
            )
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(
            f"Receipt orientation initialization failed: {type(error).__name__}",
            file=sys.stderr,
        )
        return None


def orientation_prediction(model, image):
    """Return a validated angle and confidence for an orientation-only image.

    Args:
        model: The orientation model.
        image (PIL.Image.Image): The image to be analyzed for orientation.

    Returns:
        tuple: A tuple containing the angle (int) and confidence (float) of the orientation prediction.
    """
    pixels = numpy.asarray(image)[:, :, ::-1].copy()
    with redirect_stdout(sys.stderr):
        results = model.predict(pixels)
    if len(results) != 1:
        raise ValueError("Unexpected orientation result count")
    result = results[0].json["res"]
    angle = int(result["label_names"][0])
    confidence = float(result["scores"][0])
    if (
        angle not in (0, 90, 180, 270)
        or not math.isfinite(confidence)
        or not 0 <= confidence <= 1
    ):
        raise ValueError("Invalid orientation result")
    return angle, confidence


def detect_rotation(image):
    """Detect the rotation needed to correctly orient the image.

    Args:
        image (PIL.Image.Image): The image to be analyzed for orientation.

    Returns:
        int: The clockwise rotation in degrees (0, 90, 180, 270) needed to correctly orient the image.
    """
    model = initialize_orientation()
    if model is None:
        return 0
    try:
        angle, confidence = orientation_prediction(model, image)
        if confidence >= 0.8:
            return (-angle) % 360

        # Background can dominate an uncropped photo. Use center crops only to
        # estimate orientation; receipt corners and final images stay intact.
        crop_angles = []
        for margin in (0.1, 0.2):
            left, top = int(image.width * margin), int(image.height * margin)
            crop = image.crop((left, top, image.width - left, image.height - top))
            if min(crop.size) < 2:
                return 0
            crop_angle, crop_confidence = orientation_prediction(model, crop)
            if crop_confidence < 0.9:
                return 0
            crop_angles.append(crop_angle)
        if crop_angles[0] == crop_angles[1]:
            return (-crop_angles[0]) % 360
        return 0
    except (OSError, RuntimeError, ValueError, TypeError, KeyError, IndexError) as error:
        print(f"Receipt orientation prediction failed: {type(error).__name__}", file=sys.stderr)
        return 0


def rotate_image(image, rotation):
    """Rotate the image by the specified clockwise rotation.

    Args:
        image (PIL.Image.Image): The image to be rotated.
        rotation (int): The clockwise rotation in degrees (0, 90, 180, 270).

    Returns:
        PIL.Image.Image: The rotated image.

    Raises:
        ValueError: If the rotation is not one of 0, 90, 180, 270.
    """
    if (
        isinstance(rotation, bool)
        or not isinstance(rotation, int)
        or rotation not in (0, 90, 180, 270)
    ):
        raise ValueError("rotation must be 0, 90, 180, or 270 clockwise degrees")
    if rotation == 0:
        return image
    methods = {
        90: Image.Transpose.ROTATE_270,
        180: Image.Transpose.ROTATE_180,
        270: Image.Transpose.ROTATE_90,
    }
    return image.transpose(methods[rotation])


def rotate_corners(corners, rotation):
    """Rotate the corner coordinates by the specified clockwise rotation.

    Args:
        corners (dict): The corner coordinates with keys "topLeft", "topRight", "bottomRight", "bottomLeft".
        rotation (int): The clockwise rotation in degrees (0, 90, 180, 270).

    Returns:
        dict: The rotated corner coordinates.
    """
    for _ in range(rotation // 90):
        corners = {
            "topLeft": [1 - corners["bottomLeft"][1], corners["bottomLeft"][0]],
            "topRight": [1 - corners["topLeft"][1], corners["topLeft"][0]],
            "bottomRight": [1 - corners["topRight"][1], corners["topRight"][0]],
            "bottomLeft": [1 - corners["bottomRight"][1], corners["bottomRight"][0]],
        }
    return corners
