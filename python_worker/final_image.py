from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from .orientation import rotate_image

CORNER_NAMES = ("topLeft", "topRight", "bottomRight", "bottomLeft")


def confirmed_points(corners, width, height):
    """
    Validates and converts normalized corner points to absolute pixel coordinates.

    Args:
        corners (dict): A dictionary containing the normalized corner points.
        width (int): The width of the original image.
        height (int): The height of the original image.

    Returns:
        np.ndarray: An array of absolute pixel coordinates for the corners.

    Raises:
        ValueError: If the corners are not valid or do not form a convex shape.
    """
    if not isinstance(corners, dict) or set(corners) != set(CORNER_NAMES):
        raise ValueError("corners must contain all four named corners")

    points = []
    for name in CORNER_NAMES:
        point = corners[name]
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError(f"{name} must be a normalized [x, y] point")
        if any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not np.isfinite(value)
            or not 0 <= value <= 1
            for value in point
        ):
            raise ValueError(f"{name} must contain coordinates from 0 to 1")
        points.append([point[0] * (width - 1), point[1] * (height - 1)])

    points = np.asarray(points, dtype=np.float32)
    if not cv2.isContourConvex(points.reshape(-1, 1, 2)):
        raise ValueError("corners must form a convex receipt frame")
    return points


def transformed_size(points):
    """
    Calculates the transformed size of a quadrilateral defined by its corner points.

    Args:
        points (np.ndarray): An array of corner points in the order top-left, top-right, bottom-right, bottom-left.

    Returns:
        tuple: The width and height of the transformed rectangle.

    Raises:
        ValueError: If the calculated width or height is less than 2 pixels.
    """
    top_left, top_right, bottom_right, bottom_left = points
    width = round(
        max(
            np.linalg.norm(top_right - top_left),
            np.linalg.norm(bottom_right - bottom_left),
        )
    ) + 1
    height = round(
        max(
            np.linalg.norm(bottom_left - top_left),
            np.linalg.norm(bottom_right - top_right),
        )
    ) + 1
    if width < 2 or height < 2:
        raise ValueError("receipt frame is too small")
    return width, height


def rectify_image(image, corners):
    """
    Rectifies the image based on the provided corner points.

    Args:
        image (PIL.Image.Image): The original image to be rectified.
        corners (dict): A dictionary containing the normalized corner points.

    Returns:
        PIL.Image.Image: The rectified image.
    """
    points = confirmed_points(corners, image.width, image.height)
    width, height = transformed_size(points)
    target = np.asarray(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(points, target)
    pixels = cv2.warpPerspective(
        np.asarray(image), transform, (width, height), flags=cv2.INTER_LINEAR
    )
    return Image.fromarray(pixels)


def create_final_images(original_path, corners, archive_path, ocr_path, rotation=0):
    """
    Creates the final archive and OCR images from the original image and its corner points.

    Args:
        original_path (str): The path to the original image.
        corners (dict): A dictionary containing the normalized corner points.
        archive_path (str): The path to save the final archive image.
        ocr_path (str): The path to save the final OCR image.

    Returns:
        dict: A dictionary containing the width and height of the transformed image.
    """
    with Image.open(original_path) as source:
        source.load()
        original = ImageOps.exif_transpose(source).convert("RGB")

    original = rotate_image(original, rotation)
    archive = rectify_image(original, corners)
    ocr = ImageOps.autocontrast(ImageOps.grayscale(archive), cutoff=1)

    Path(archive_path).parent.mkdir(parents=True, exist_ok=True)
    Path(ocr_path).parent.mkdir(parents=True, exist_ok=True)
    archive.save(archive_path, format="WEBP", quality=90)
    ocr.save(ocr_path, format="WEBP", lossless=True)
    return {"width": archive.width, "height": archive.height}
