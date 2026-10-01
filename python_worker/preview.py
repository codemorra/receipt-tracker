from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

from .final_image import rectify_image
from .orientation import rotate_corners, rotate_image


def suggested_corners(image):
    """Suggests the corners of a receipt in the given image.

    If the necessary libraries (OpenCV and NumPy) are not available, or if a clear receipt outline
    cannot be detected, default corners are returned.

    Args:
        image (PIL.Image.Image): The image in which to suggest receipt corners.

    Returns:
        dict: A dictionary containing the suggested corners of the receipt, with keys "topLeft", "topRight", "bottomRight", and "bottomLeft". Each value is a list of two floats representing the normalized coordinates of the corner.
    """
    try:
        import cv2
        import numpy
    except ImportError:
        return default_corners()

    analysis = image.copy()
    analysis.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
    pixels = numpy.asarray(analysis)
    blurred = cv2.GaussianBlur(pixels, (9, 9), 0)
    gray = cv2.cvtColor(blurred, cv2.COLOR_RGB2GRAY)
    lab = cv2.cvtColor(blurred, cv2.COLOR_RGB2LAB)
    warm_colors = lab[:, :, 1:].max(axis=2)
    _, bright_mask = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if not numpy.any(bright_mask):
        return default_corners()
    color_threshold, _ = cv2.threshold(
        warm_colors[bright_mask > 0], 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    paper_mask = cv2.bitwise_and(
        bright_mask, cv2.inRange(warm_colors, 0, max(128, color_threshold))
    )
    paper_mask = cv2.morphologyEx(
        paper_mask, cv2.MORPH_CLOSE, numpy.ones((9, 9), dtype=numpy.uint8)
    )
    paper_mask = cv2.morphologyEx(
        paper_mask, cv2.MORPH_OPEN, numpy.ones((5, 5), dtype=numpy.uint8)
    )
    corners = contour_corners(paper_mask, analysis, cv2)
    if corners is not None:
        return corners

    edges = cv2.Canny(gray, 60, 160)
    return contour_corners(edges, analysis, cv2) or default_corners()


def contour_corners(mask, image, cv2):
    """Finds the corners of a receipt-like contour in the given mask.

    Args:
        mask (numpy.ndarray): The binary mask in which to find contours.
        image (PIL.Image.Image): The image corresponding to the mask.
        cv2: The OpenCV module.

    Returns:
        dict or None: A dictionary containing the corners of the detected receipt-like contour, or None if no suitable contour is found.
    """
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.width * image.height
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < image_area * 0.1:
            break
        hull = cv2.convexHull(contour)
        hull_area = cv2.contourArea(hull)
        if area < hull_area * 0.85:
            continue
        polygon = cv2.approxPolyDP(hull, cv2.arcLength(hull, True) * 0.025, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        if cv2.contourArea(polygon) < hull_area * 0.9:
            continue
        points = [point[0].tolist() for point in polygon]
        if any(
            x <= 1 or y <= 1 or x >= image.width - 2 or y >= image.height - 2
            for x, y in points
        ):
            continue
        points.sort(key=lambda point: point[1])
        top = sorted(points[:2], key=lambda point: point[0])
        bottom = sorted(points[2:], key=lambda point: point[0])
        margin = max(image.size) * 0.004
        return {
            "topLeft": normalized_point([top[0][0] - margin, top[0][1] - margin], image),
            "topRight": normalized_point([top[1][0] + margin, top[1][1] - margin], image),
            "bottomRight": normalized_point([bottom[1][0] + margin, bottom[1][1] + margin], image),
            "bottomLeft": normalized_point([bottom[0][0] - margin, bottom[0][1] + margin], image),
        }
    return None


def normalized_point(point, image):
    """Normalizes a point's coordinates relative to the image dimensions, clamping them between 0 and 1.

    Args:
        point (list): A list of two floats representing the x and y coordinates of the point.
        image (PIL.Image.Image): The image to which the point belongs.

    Returns:
        list: A list of two floats representing the normalized coordinates of the point, clamped between 0 and 1.
    """
    return [
        round(max(0, min(1, point[0] / image.width)), 5),
        round(max(0, min(1, point[1] / image.height)), 5),
    ]


def default_corners():
    """Returns the default corners of a receipt in the image.
    
    Returns:
        dict: A dictionary containing the default corners of the receipt, with keys "topLeft", "topRight", "bottomRight", and "bottomLeft". Each value is a list of two floats representing the normalized coordinates of the corner.
    """
    return {
        "topLeft": [0, 0],
        "topRight": [1, 0],
        "bottomRight": [1, 1],
        "bottomLeft": [0, 1],
    }


def create_preview(original_path, preview_path, orientation_detector=None):
    """Creates a preview image from the original image, enhancing brightness and contrast, and suggesting receipt corners.

    Args:
        original_path (str): The file path to the original image.
        preview_path (str): The file path where the preview image will be saved.

    Returns:
        dict: A dictionary containing the width, height, and suggested corners of the preview image.
    """
    with Image.open(original_path) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert("RGB")

    image.thumbnail((2400, 2400), Image.Resampling.LANCZOS)
    image = ImageEnhance.Brightness(image).enhance(1.04)
    image = ImageEnhance.Contrast(image).enhance(1.06)
    corners = suggested_corners(image)
    rotation = 0
    if orientation_detector is not None:
        rotation = orientation_detector(rectify_image(image, corners))
        image = rotate_image(image, rotation)
        corners = rotate_corners(corners, rotation)

    Path(preview_path).parent.mkdir(parents=True, exist_ok=True)
    image.save(preview_path, format="WEBP", quality=82)
    return {
        "width": image.width,
        "height": image.height,
        "suggestedCorners": corners,
        "rotation": rotation,
    }
