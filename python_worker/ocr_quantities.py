"""Conservative image-based repair of two quantities detected as one tall box."""

import logging
import math
import sys
from contextlib import redirect_stdout
from statistics import mean, median

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)


def _split_candidates(raw, width, height):
    """Identify candidate quantities that may be split into two rows based on surrounding anchors.

    Args:
        raw (dict): The raw OCR result containing 'rec_texts' and 'rec_boxes'.
        width (int): The width of the image.
        height (int): The height of the image.

    Returns:
        list: A list of candidates, each represented as a tuple (index, text, [top_box, bottom_box]).
    """
    candidates = []
    for index, (text, box) in enumerate(zip(raw["rec_texts"], raw["rec_boxes"])):
        text = text.strip()
        x1, y1, x2, y2 = map(int, box)
        box_height = y2 - y1
        if not (
            len(text) == 2 and text.isascii() and text.isdigit()
            and 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height
            and box_height > x2 - x1
        ):
            continue

        anchors = []
        for other_index, (other_text, other) in enumerate(zip(raw["rec_texts"], raw["rec_boxes"])):
            left, top, right, bottom = other
            center = (top + bottom) / 2
            anchor_height = bottom - top
            if (
                other_index != index and other_text.strip()
                and right - left >= 2 * anchor_height
                and y1 <= center <= y2
                and (right <= x1 or left >= x2)
            ):
                anchors.append((center, anchor_height, left, right))
        if not anchors:
            continue
        normal_height = median(anchor[1] for anchor in anchors)
        if box_height < 1.5 * normal_height:
            continue

        rows = []
        for anchor in sorted(anchors):
            if rows and anchor[0] - mean(item[0] for item in rows[-1]) <= normal_height / 3:
                rows[-1].append(anchor)
            else:
                rows.append([anchor])
        # Each row must be independently supported on both sides of the quantity.
        if len(rows) != 2 or any(
            not (any(anchor[3] <= x1 for anchor in row) and any(anchor[2] >= x2 for anchor in row))
            for row in rows
        ):
            continue
        centers = [mean(anchor[0] for anchor in row) for row in rows]
        if centers[1] - centers[0] < normal_height * 0.6:
            continue
        split_y = round(mean(centers))
        if not all(0.5 * normal_height <= part <= 1.5 * normal_height for part in (split_y - y1, y2 - split_y)):
            continue
        candidates.append((index, text, [[x1, y1, x2, split_y], [x1, split_y, x2, y2]]))
    return candidates


def separate_quantity_rows(ocr, raw, image_path, width, height):
    """Attempt to separate quantities into two rows based on candidate anchors.

    Args:
        ocr: The OCR engine instance used for re-recognition.
        raw (dict): The raw OCR result containing 'rec_texts' and 'rec_boxes'.
        image_path (str): The path to the image being processed.
        width (int): The width of the image.
        height (int): The height of the image.

    Returns:
        dict: The potentially repaired OCR result, or the original raw result if no repair was made.
    """

    candidates = _split_candidates(raw, width, height)
    if not candidates:
        return raw

    try:
        with Image.open(image_path) as image:
            pixels = np.asarray(image.convert("RGB"))[:, :, ::-1]
        crops = []
        for _, _, boxes in candidates:
            for x1, y1, x2, y2 in boxes:
                crops.append(pixels[max(0, y1 - 2):min(height, y2 + 2), max(0, x1 - 3):min(width, x2 + 3)].copy())
        order = sorted(range(len(crops)), key=lambda i: crops[i].shape[1] / crops[i].shape[0])
        with redirect_stdout(sys.stderr):
            predictions = list(ocr.paddlex_pipeline.text_rec_model([crops[i] for i in order]))
        if len(predictions) != len(crops):
            return raw
        recognized = [None] * len(crops)
        for index, prediction in zip(order, predictions):
            recognized[index] = (prediction["rec_text"].strip(), float(prediction["rec_score"]))
    except (OSError, RuntimeError, ValueError, TypeError, KeyError):
        # A supplementary recognition pass must not discard a usable initial OCR.
        logger.warning("Quantity re-recognition failed; retaining original OCR")
        return raw

    replacements = {}
    for position, (index, original_text, boxes) in enumerate(candidates):
        parts = recognized[2 * position:2 * position + 2]
        if all(
            text == original_text[part] and math.isfinite(score) and 0.9 <= score <= 1
            for part, (text, score) in enumerate(parts)
        ):
            replacements[index] = (parts, boxes)
    if not replacements:
        return raw

    # Only recognition fields are passed to the row shaper. Detection metadata
    # continues to describe the unmodified raw prediction, not these new boxes.
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
