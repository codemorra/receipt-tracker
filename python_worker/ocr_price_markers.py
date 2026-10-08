"""Separate prices from tax markers only with legend and image confirmation."""

import logging
import math
import re
import sys
from contextlib import redirect_stdout

import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)
TAX_LEGEND = re.compile(r"([0-9])\s*=\s*[0-9]{1,2}[,.][0-9]{2}\s*%")
PRICE_MARKER = re.compile(r"([0-9]+[,.][0-9]{2})([0-9])")


def _marker_boxes(gray, box):
    """Identify a uniquely large internal gap within a price marker box.

    Args:
        gray (np.ndarray): Grayscale image of the receipt.
        box (list[int]): Bounding box coordinates [x1, y1, x2, y2].

    Returns:
        list[list[int]] | None: Split boxes if a unique large gap is found, otherwise None.
    """
    x1, y1, x2, y2 = box
    crop = gray[y1:y2, x1:x2]
    _, ink = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    occupied = np.count_nonzero(ink, axis=0) >= max(2, crop.shape[0] * 0.1)
    gaps = []
    start = None
    for x, filled in enumerate(occupied):
        if not filled and start is None:
            start = x
        elif filled and start is not None:
            if start > 0:
                gaps.append((start, x))
            start = None
    # A trailing empty run is padding, not an internal field separator.
    gaps.sort(key=lambda gap: gap[1] - gap[0], reverse=True)
    if not gaps:
        return None
    start, end = gaps[0]
    gap_width = end - start
    box_height = y2 - y1
    if gap_width < box_height / 2 or (len(gaps) > 1 and gap_width < 2 * (gaps[1][1] - gaps[1][0])):
        return None
    split = (start + end) // 2
    if split < box_height or not 0 < x2 - x1 - split <= box_height:
        return None
    return [[x1, y1, x1 + split, y2], [x1 + split, y1, x2, y2]]


def separate_price_markers(ocr, raw, image_path, width, height):
    """Separate price markers from tax markers using legend and image confirmation.

    Args:
        ocr: OCR engine instance.
        raw (dict): Initial OCR result containing recognized texts and bounding boxes.
        image_path (str): Path to the receipt image.
        width (int): Width of the receipt image.
        height (int): Height of the receipt image.

    Returns:
        dict: Updated OCR result with separated price markers if confirmed, otherwise the original result.
    """
    markers = {
        match[1] for text in raw["rec_texts"]
        if (match := TAX_LEGEND.fullmatch(text.strip()))
    }
    candidates = []
    for index, (text, box) in enumerate(zip(raw["rec_texts"], raw["rec_boxes"])):
        match = PRICE_MARKER.fullmatch(text.strip())
        if match is None or match[2] not in markers:
            continue
        x1, y1, x2, y2 = map(int, box)
        if width / 2 <= x1 < x2 <= width and 0 <= y1 < y2 <= height:
            candidates.append((index, (match[1], match[2]), [x1, y1, x2, y2]))
    if not candidates:
        return raw

    # Attempt to separate price markers based on image analysis and OCR confirmation.
    try:
        with Image.open(image_path) as image:
            gray = np.asarray(image.convert("L"))
            pixels = np.asarray(image.convert("RGB"))[:, :, ::-1]
        splits = []
        crops = []
        for index, expected, box in candidates:
            boxes = _marker_boxes(gray, box)
            if boxes is None:
                continue
            splits.append((index, expected, boxes))
            for x1, y1, x2, y2 in boxes:
                crops.append(np.pad(pixels[y1:y2, x1:x2], ((3, 3), (3, 3), (0, 0)), constant_values=255))
        if not crops:
            return raw
        order = sorted(range(len(crops)), key=lambda i: crops[i].shape[1] / crops[i].shape[0])
        with redirect_stdout(sys.stderr):
            predictions = list(ocr.paddlex_pipeline.text_rec_model([crops[i] for i in order]))
        if len(predictions) != len(crops):
            return raw
        recognized = [None] * len(crops)
        for index, prediction in zip(order, predictions):
            text = prediction["rec_text"]
            if not isinstance(text, str):
                return raw
            recognized[index] = (text.strip(), float(prediction["rec_score"]))
    except (OSError, RuntimeError, ValueError, TypeError, KeyError, cv2.error):
        logger.warning("Price marker re-recognition failed; retaining original OCR")
        return raw

    # Confirm and apply recognized splits to the original OCR result.
    replacements = {}
    for position, (index, expected, boxes) in enumerate(splits):
        parts = recognized[2 * position:2 * position + 2]
        if all(text == wanted and math.isfinite(score) and 0.9 <= score <= 1 for (text, score), wanted in zip(parts, expected)):
            replacements[index] = (parts, boxes)
    if not replacements:
        return raw

    # If no replacements were confirmed, return the original OCR result.
    keys = ["rec_texts", "rec_scores", "rec_boxes"]
    if raw.get("rec_polys") is not None:
        keys.append("rec_polys")
    repaired = {key: [] for key in keys}
    for index in range(len(raw["rec_texts"])):
        if index not in replacements:
            for key in keys:
                repaired[key].append(raw[key][index])
            continue
        parts, boxes = replacements[index]
        for (text, score), box in zip(parts, boxes):
            repaired["rec_texts"].append(text)
            repaired["rec_scores"].append(score)
            repaired["rec_boxes"].append(box)
            if "rec_polys" in repaired:
                x1, y1, x2, y2 = box
                repaired["rec_polys"].append([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return repaired
