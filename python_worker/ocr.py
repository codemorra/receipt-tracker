import math
import os
import sys
from contextlib import redirect_stdout
from functools import cache
from pathlib import Path

from PIL import Image

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
        A dictionary with "plainText" and "lines", where each line has "text", "confidence", and "box".
    """
    texts = result["rec_texts"]
    scores = result["rec_scores"]
    boxes = result["rec_boxes"]
    if len(texts) != len(scores) or len(texts) != len(boxes):
        raise ValueError("OCR text, confidence, and box counts differ")

    lines = []

    # Process each OCR line and normalize its bounding box.
    for raw_text, raw_score, raw_box in zip(texts, scores, boxes):
        text = raw_text.strip()
        if not text:
            continue
        score = float(raw_score)
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("OCR confidence must be between 0 and 1")
        lines.append({
            "text": text,
            "confidence": score,
            "box": normalized_box(raw_box, width, height),
        })

    lines.sort(
        key=lambda line: ((line["box"][1] + line["box"][3]) / 2, line["box"][0])
    )
    rows = []

    # Group lines into rows based on their vertical positions.
    for line in lines:
        center = (line["box"][1] + line["box"][3]) / 2
        height = line["box"][3] - line["box"][1]
        if rows and center - rows[-1]["center"] <= min(height, rows[-1]["height"]) / 2:
            rows[-1]["lines"].append(line)
        else:
            rows.append({"center": center, "height": height, "lines": [line]})

    ordered = []

    # Order lines within each row from left to right and assign indices.
    for row in rows:
        ordered.extend(sorted(row["lines"], key=lambda line: line["box"][0]))

    # Assign indices to the ordered lines.
    for index, line in enumerate(ordered):
        line["index"] = index

    return {"plainText": "\n".join(line["text"] for line in ordered), "lines": ordered}


def recognize_image(ocr, image_path):
    """Recognize text from an image using the provided OCR instance.

    Args:
        ocr: An OCR instance with a predict method.
        image_path: Path to the image file.

    Returns:
        A structured OCR result with "plainText" and "lines".
    """
    with Image.open(image_path) as image:
        width, height = image.size
    with redirect_stdout(sys.stderr):
        results = ocr.predict(str(Path(image_path)))
    if len(results) != 1:
        raise ValueError("PaddleOCR returned an unexpected number of results")
    return shape_ocr_result(results[0].json["res"], width, height)
