import math
import os
import re
import sys
from contextlib import redirect_stdout
from functools import cache
from pathlib import Path
from statistics import median

from PIL import Image

from .ocr_overlaps import merge_quantity_fragments
from .ocr_quantities import separate_quantity_rows

# Configuration options for the PaddleOCR instance.
OCR_OPTIONS = {
    "text_detection_model_name": "PP-OCRv6_medium_det",
    "text_recognition_model_name": "PP-OCRv6_medium_rec",
    "ocr_version": "PP-OCRv6",
    "lang": "german",
    "device": "cpu",
    "enable_hpi": True,
    "enable_mkldnn": True,
    "text_recognition_batch_size": 8,
    "use_doc_orientation_classify": False,
    "use_doc_unwarping": False,
    "use_textline_orientation": False,
    "text_det_limit_side_len": 16384,
    "text_det_limit_type": "max",
    "text_det_box_thresh": 0.4,
}


@cache
def initialize_ocr():
    """Initialize and return a PaddleOCR instance."""
    python_bin = str(Path(sys.executable).parent)
    os.environ["PATH"] = os.pathsep.join((python_bin, os.environ.get("PATH", "")))
    with redirect_stdout(sys.stderr):
        from paddleocr import PaddleOCR  # type: ignore

        return PaddleOCR(**OCR_OPTIONS)


def normalized_box(box, width, height):
    """Normalize an OCR bounding box to the range [0, 1] relative to the image dimensions.

    Args:
        box: A list of four coordinates [x_min, y_min, x_max, y_max].
        width: The width of the image.
        height: The height of the image.

    Returns:
        A list of four normalized coordinates [x_min, y_min, x_max, y_max] in the range [0, 1].
    """
    if len(box) != 4 or not all(math.isfinite(float(value)) for value in box):
        raise ValueError("OCR line box must contain four finite coordinates")
    x_min, y_min, x_max, y_max = box
    if x_min >= x_max or y_min >= y_max:
        raise ValueError("OCR line box must have positive area")
    return [
        max(0.0, min(1.0, float(x_min) / width)),
        max(0.0, min(1.0, float(y_min) / height)),
        max(0.0, min(1.0, float(x_max) / width)),
        max(0.0, min(1.0, float(y_max) / height)),
    ]


def shape_ocr_result(result, width, height):
    """Shape the OCR result into a structured format with ordered lines and normalized boxes.

    Args:
        result: The raw OCR result containing "rec_texts", "rec_scores", and "rec_boxes".
        width: The width of the image.
        height: The height of the image.

    Returns:
        A dictionary with "plainText", "lines", and grouped "rows".
    """
    texts = result["rec_texts"]
    scores = result["rec_scores"]
    boxes = result["rec_boxes"]
    polygons = result.get("rec_polys")
    if polygons is not None and len(polygons) != len(texts):
        raise ValueError("OCR polygon and text counts differ")
    if len(texts) != len(scores) or len(texts) != len(boxes):
        raise ValueError("OCR text, confidence, and box counts differ")

    lines = []
    row_tilts = []

    # Process each OCR line and normalize its bounding box.
    for position, (raw_text, raw_score, raw_box) in enumerate(zip(texts, scores, boxes)):
        text = raw_text.strip()
        if not text:
            continue
        score = float(raw_score)
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("OCR confidence must be between 0 and 1")
        box = normalized_box(raw_box, width, height)
        center = (float(raw_box[1]) + float(raw_box[3])) / 2
        tilt = None
        if polygons is not None:
            polygon = polygons[position]
            if len(polygon) != 4 or any(
                len(point) != 2 or not all(math.isfinite(float(value)) for value in point)
                for point in polygon
            ):
                raise ValueError("OCR polygon must contain four finite points")
            left_x = (float(polygon[0][0]) + float(polygon[3][0])) / 2
            right_x = (float(polygon[1][0]) + float(polygon[2][0])) / 2
            left_y = (float(polygon[0][1]) + float(polygon[3][1])) / 2
            right_y = (float(polygon[1][1]) + float(polygon[2][1])) / 2
            # A narrow glyph's slant is not a reliable estimate of the row's tilt.
            narrow_character = len(text) == 1 and right_x - left_x < 2 * (
                float(raw_box[3]) - float(raw_box[1])
            )
            if right_x > left_x and not narrow_character:
                slope = (right_y - left_y) / (right_x - left_x)
                center = (left_y + right_y) / 2 + slope * (width / 2 - (left_x + right_x) / 2)
                if len(text) > 1:
                    tilt = {
                        "width": right_x - left_x,
                        "height": float(raw_box[3]) - float(raw_box[1]),
                        "centerX": (left_x + right_x) / 2,
                        "centerY": (left_y + right_y) / 2,
                        "boxCenterY": (float(raw_box[1]) + float(raw_box[3])) / 2,
                        "slope": slope,
                    }
        line = {
            "rowCenter": center / height,
            "text": text,
            "confidence": score,
            "box": box,
        }
        lines.append(line)
        if tilt is not None:
            row_tilts.append((line, tilt))

    # Estimate short segments' tilt from already validated, wider neighboring
    # text. Disagreeing anchors must not override the original polygon geometry.
    anchors = [tilt for _, tilt in row_tilts if tilt["width"] >= 4 * tilt["height"]]
    for line, tilt in row_tilts:
        if tilt["width"] >= 3 * tilt["height"]:
            continue
        slopes = [
            anchor["slope"] for anchor in anchors
            if abs(anchor["boxCenterY"] - tilt["boxCenterY"]) <= 2 * tilt["height"]
        ]
        if len(slopes) < 2:
            continue
        distance = width / 2 - tilt["centerX"]
        # Anchor disagreement may displace this segment by at most one third
        # of its height, matching the tolerance used to group receipt rows.
        if (max(slopes) - min(slopes)) * abs(distance) > tilt["height"] / 3:
            continue
        line["rowCenter"] = (tilt["centerY"] + median(slopes) * distance) / height

    lines.sort(
        key=lambda line: (line["rowCenter"], line["box"][0])
    )
    rows = []

    # Group lines into rows based on their vertical positions.
    for line in lines:
        center = line["rowCenter"]
        line_height = line["box"][3] - line["box"][1]
        if rows and center - rows[-1]["center"] <= min(line_height, rows[-1]["height"]) / 3:
            rows[-1]["lines"].append(line)
        else:
            rows.append({"center": center, "height": line_height, "lines": [line]})

    rows = join_isolated_amount_rows(rows)
    ordered = []

    # Order lines within each row from left to right and assign indices.
    for row in rows:
        ordered.extend(sorted(row["lines"], key=lambda line: line["box"][0]))

    # Assign indices to the ordered lines.
    for index, line in enumerate(ordered):
        line["index"] = index
        del line["rowCenter"]

    visual_rows = []

    # Create visual representation of rows with their segments and line indices.
    for index, row in enumerate(rows):
        row_lines = sorted(row["lines"], key=lambda line: line["box"][0])
        visual_rows.append({
            "rowIndex": index,
            "segments": [
                {"text": line["text"], "x": round(line["box"][0], 3)}
                for line in row_lines
            ],
            "lineIndexes": [line["index"] for line in row_lines],
        })

    return {
        "plainText": "\n".join(line["text"] for line in ordered),
        "lines": ordered,
        "rows": visual_rows,
    }


def join_isolated_amount_rows(rows):
    """Join unambiguous, vertically overlapping label/amount singleton rows.

    Args:
        rows (list): A list of row dictionaries, each containing "center", "height", and "lines".

    Returns:
        list: A list of merged row dictionaries.
    """
    candidates = []
    counts = [0] * len(rows)
    for index, first in enumerate(rows):
        for next_index in range(index + 1, len(rows)):
            second = rows[next_index]
            if second["center"] - first["center"] > first["height"] / 2:
                break
            if len(first["lines"]) != 1 or len(second["lines"]) != 1:
                continue
            left, right = sorted(first["lines"] + second["lines"], key=lambda line: line["box"][0])
            if not any(character.isalpha() for character in left["text"]):
                continue
            if re.fullmatch(r"(?:€\s*)?[-−]?\d+[,.]\d{2}(?:\s*€)?", right["text"]) is None:
                continue
            a, b = left["box"], right["box"]
            if not a[2] <= 0.5 <= b[0]:
                continue
            minimum_height = min(a[3] - a[1], b[3] - b[1])
            overlap = min(a[3], b[3]) - max(a[1], b[1])
            if overlap < minimum_height / 2 or second["center"] - first["center"] > minimum_height / 2:
                continue
            candidates.append((index, next_index))
            counts[index] += 1
            counts[next_index] += 1

    # An amount between two plausible labels must remain unassigned.
    accepted = {
        index for index, next_index in candidates
        if next_index == index + 1 and counts[index] == counts[next_index] == 1
    }
    merged = []
    for index, row in enumerate(rows):
        if index - 1 in accepted:
            continue
        if index in accepted:
            row = {**row, "lines": row["lines"] + rows[index + 1]["lines"]}
        merged.append(row)
    return merged


def recognize_image(ocr, image_path):
    """Recognize text from an image using the provided OCR instance.

    Args:
        ocr: An OCR instance with a predict method.
        image_path: Path to the image file.

    Returns:
        A structured OCR result with "plainText", "lines", and "rows".
    """
    with Image.open(image_path) as image:
        width, height = image.size
    with redirect_stdout(sys.stderr):
        results = ocr.predict(str(Path(image_path)))
    if len(results) != 1:
        raise ValueError("PaddleOCR returned an unexpected number of results")
    raw = results[0].json["res"]
    shaped = shape_ocr_result(raw, width, height)
    repaired = separate_quantity_rows(ocr, raw, image_path, width, height)
    repaired = merge_quantity_fragments(ocr, repaired, image_path, width, height)
    return shaped if repaired is raw else shape_ocr_result(repaired, width, height)
