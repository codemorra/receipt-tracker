"""Re-recognize overlapping multiplication fragments without inventing numbers."""

import logging
import math
import re
import sys
from collections import Counter
from contextlib import redirect_stdout

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)
PRICE_FRAGMENT = re.compile(r"([0-9]+[,.][0-9]{2})\s*[x×]")
QUANTITY_FRAGMENT = re.compile(r"[x×]\s*([0-9]+)")
MULTIPLICATION = re.compile(r"([0-9]+[,.][0-9]{2})\s*[x×]\s*([0-9]+)")


def _overlap_candidates(raw, width, height):
    """Identify candidate overlapping price-x / x-quantity fragments based on their geometry.

    Args:
        raw (dict): The raw OCR result containing recognized texts and their bounding boxes.
        width (int): The width of the image.
        height (int): The height of the image.

    Returns:
        list: A list of candidate overlapping fragments, each represented as a tuple
              (first_index, second_index, price, quantity, bounding_box).
    """
    prices = []
    quantities = []
    for index, text in enumerate(raw["rec_texts"]):
        price = PRICE_FRAGMENT.fullmatch(text.strip())
        quantity = QUANTITY_FRAGMENT.fullmatch(text.strip())
        if price:
            prices.append((index, price[1]))
        elif quantity:
            quantities.append((index, quantity[1]))

    candidates = []
    for first, price in prices:
        left, top, right, bottom = raw["rec_boxes"][first]
        for second, quantity in quantities:
            other_left, other_top, other_right, other_bottom = raw["rec_boxes"][second]
            if not left < other_left < right < other_right:
                continue
            min_height = min(bottom - top, other_bottom - other_top)
            if abs((top + bottom - other_top - other_bottom) / 2) > min_height / 3:
                continue
            intersection = (right - other_left) * max(0, min(bottom, other_bottom) - max(top, other_top))
            smaller_area = min((right - left) * (bottom - top), (other_right - other_left) * (other_bottom - other_top))
            if intersection < 0.12 * smaller_area:
                continue
            box = [int(left), int(min(top, other_top)), int(other_right), int(max(bottom, other_bottom))]
            x1, y1, x2, y2 = box
            if 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height:
                candidates.append((first, second, price, quantity, box))

    # A fragment shared by multiple plausible pairs is ambiguous; keep them all.
    uses = Counter(index for first, second, *_ in candidates for index in (first, second))
    return [candidate for candidate in candidates if uses[candidate[0]] == uses[candidate[1]] == 1]


def merge_quantity_fragments(ocr, raw, image_path, width, height):
    """Merge only overlapping price-x / x-quantity boxes confirmed by a new crop.

    The input recognition fields have already been validated. Original evidence
    is retained when geometry or the supplementary recognition is uncertain.

    Args:
        ocr: The OCR engine instance used for re-recognition.
        raw (dict): The raw OCR result containing recognized texts and their bounding boxes.
        image_path (str): The path to the image file.
        width (int): The width of the image.
        height (int): The height of the image.

    Returns:
        dict: The updated OCR result with merged quantity fragments.
    """

    candidates = _overlap_candidates(raw, width, height)
    if not candidates:
        return raw

    try:
        with Image.open(image_path) as image:
            pixels = np.asarray(image.convert("RGB"))[:, :, ::-1]
        # Keep boundary strokes away from the recognition crop's edge. This is
        # local to confirmed overlapping fragments, not global OCR preprocessing.
        crops = [
            np.pad(pixels[y1:y2, x1:x2], ((3, 3), (3, 3), (0, 0)), constant_values=255)
            for *_, (x1, y1, x2, y2) in candidates
        ]
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
    except (OSError, RuntimeError, ValueError, TypeError, KeyError):
        logger.warning("Multiplication re-recognition failed; retaining original OCR")
        return raw

    replacements = {}
    removed = set()
    for (first, second, price, quantity, box), (text, score) in zip(candidates, recognized):
        confirmed = MULTIPLICATION.fullmatch(text)
        if (
            confirmed and math.isfinite(score) and 0.9 <= score <= 1
            and confirmed[1].replace(".", ",") == price.replace(".", ",")
            and confirmed[2] == quantity
        ):
            replacements[first] = (text, score, box)
            removed.add(second)
    if not replacements:
        return raw

    keys = ["rec_texts", "rec_scores", "rec_boxes"]
    if raw.get("rec_polys") is not None:
        keys.append("rec_polys")
    repaired = {key: [] for key in keys}
    for index in range(len(raw["rec_texts"])):
        if index in removed:
            continue
        if index not in replacements:
            for key in keys:
                repaired[key].append(raw[key][index])
            continue
        text, score, box = replacements[index]
        repaired["rec_texts"].append(text)
        repaired["rec_scores"].append(score)
        repaired["rec_boxes"].append(box)
        if "rec_polys" in repaired:
            x1, y1, x2, y2 = box
            repaired["rec_polys"].append([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return repaired
