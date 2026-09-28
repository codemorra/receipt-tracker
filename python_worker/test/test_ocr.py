import sys
from types import SimpleNamespace

import pytest
from PIL import Image

from python_worker.ocr import initialize_ocr, recognize_image, shape_ocr_result


def test_ocr_lines_are_ordered_indexed_and_normalized():
    """Test that OCR lines are ordered by their position, indexed correctly, and boxes are normalized."""
    result = shape_ocr_result(
        {
            "rec_texts": ["  1,19  ", "EDEKA", "MILCH"],
            "rec_scores": [0.91, 0.98, 0.93],
            "rec_boxes": [[90, 80, 210, 100], [20, 10, 100, 30], [10, 80, 80, 100]],
        },
        200,
        100,
    )

    assert result["plainText"] == "EDEKA\nMILCH\n1,19"
    assert [line["index"] for line in result["lines"]] == [0, 1, 2]
    assert [line["confidence"] for line in result["lines"]] == [0.98, 0.93, 0.91]
    assert result["lines"][2]["box"] == [0.45, 0.8, 1.0, 1.0]


def test_ocr_empty_result_has_no_lines():
    """Test that an empty OCR result produces no lines."""
    assert shape_ocr_result(
        {"rec_texts": [], "rec_scores": [], "rec_boxes": []}, 100, 200
    ) == {"plainText": "", "lines": []}


def test_ocr_rejects_mismatched_result_lists():
    """Test that OCR results with mismatched text, score, and box counts are rejected."""
    with pytest.raises(ValueError, match="counts differ"):
        shape_ocr_result(
            {"rec_texts": ["text"], "rec_scores": [], "rec_boxes": []}, 100, 200
        )


def test_recognize_image_uses_paddle_result_and_image_dimensions(tmp_path):
    """Test that recognize_image uses the PaddleOCR result and image dimensions correctly.
    
    Args:
        tmp_path: pathlib.Path
    """
    image_path = tmp_path / "ocr.webp"
    Image.new("RGB", (200, 100), "white").save(image_path)

    class FakeOCR:
        def predict(self, path):
            assert path == str(image_path)
            return [SimpleNamespace(json={"res": {
                "rec_texts": ["Receipt"],
                "rec_scores": [0.95],
                "rec_boxes": [[20, 10, 100, 30]],
            }})]

    result = recognize_image(FakeOCR(), image_path)
    assert result["plainText"] == "Receipt"
    assert result["lines"][0]["box"] == [0.1, 0.1, 0.5, 0.3]


def test_lines_on_the_same_row_are_ordered_left_to_right():
    """Test that OCR lines on the same row are ordered from left to right."""
    result = shape_ocr_result(
        {
            "rec_texts": ["RIGHT", "LEFT"],
            "rec_scores": [0.9, 0.9],
            "rec_boxes": [[100, 79, 160, 99], [10, 80, 70, 100]],
        },
        200,
        200,
    )

    assert result["plainText"] == "LEFT\nRIGHT"


def test_initialize_ocr_reuses_the_same_instance(monkeypatch):
    instances = []

    class FakeOCR:
        def __init__(self, **options):
            instances.append(self)

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCR=FakeOCR))
    initialize_ocr.cache_clear()
    try:
        first = initialize_ocr()
        assert initialize_ocr() is first
        assert instances == [first]
    finally:
        initialize_ocr.cache_clear()
