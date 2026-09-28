from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps


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

    pixels = cv2.cvtColor(numpy.asarray(image), cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(pixels, (5, 5), 0)
    edges = cv2.Canny(blurred, 60, 160)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.width * image.height

    # Iterate through the contours, looking for a quadrilateral that could represent the receipt.
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) < image_area * 0.2:
            break
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, perimeter * 0.025, True)

        # Skip small contours that are unlikely to be the receipt.
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue

        points = sorted((point[0].tolist() for point in polygon), key=lambda point: point[1])
        top = sorted(points[:2], key=lambda point: point[0])
        bottom = sorted(points[2:], key=lambda point: point[0])
        return {
            "topLeft": normalized_point(top[0], image),
            "topRight": normalized_point(top[1], image),
            "bottomRight": normalized_point(bottom[1], image),
            "bottomLeft": normalized_point(bottom[0], image),
        }

    return default_corners()


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
    """Returns the default corners of a receipt in the image."""
    return {
        "topLeft": [0.04, 0.04],
        "topRight": [0.96, 0.04],
        "bottomRight": [0.96, 0.96],
        "bottomLeft": [0.04, 0.96],
    }


def create_preview(original_path, preview_path):
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

    Path(preview_path).parent.mkdir(parents=True, exist_ok=True)
    image.save(preview_path, format="WEBP", quality=82)
    return {"width": image.width, "height": image.height, "suggestedCorners": corners}
