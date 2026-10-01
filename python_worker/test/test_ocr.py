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
    assert result["rows"] == [
        {"rowIndex": 0, "segments": [{"text": "EDEKA", "x": 0.1}], "lineIndexes": [0]},
        {"rowIndex": 1, "segments": [
            {"text": "MILCH", "x": 0.05},
            {"text": "1,19", "x": 0.45},
        ], "lineIndexes": [1, 2]},
    ]


def test_ocr_empty_result_has_no_lines():
    """Test that an empty OCR result produces no lines."""
    assert shape_ocr_result(
        {"rec_texts": [], "rec_scores": [], "rec_boxes": []}, 100, 200
    ) == {"plainText": "", "lines": [], "rows": []}


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
    assert result["rows"] == [
        {"rowIndex": 0, "segments": [
            {"text": "LEFT", "x": 0.05},
            {"text": "RIGHT", "x": 0.5},
        ], "lineIndexes": [0, 1]}
    ]


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


def test_sloped_text_pairs_prices_without_merging_the_header_or_repeated_items():
    """Test that sloped text pairs prices correctly without merging the header or repeated items."""
    result = shape_ocr_result(
        {
            "rec_texts": ["EUR", "Snack", "0,99", "Snack", "0,99"],
            "rec_scores": [0.9] * 5,
            "rec_boxes": [
                [710, 85, 810, 120],
                [10, 100, 310, 145],
                [710, 135, 810, 170],
                [10, 150, 310, 195],
                [710, 185, 810, 220],
            ],
            "rec_polys": [
                [[710, 85], [810, 90], [810, 120], [710, 115]],
                [[10, 100], [310, 115], [310, 145], [10, 130]],
                [[710, 135], [810, 140], [810, 170], [710, 165]],
                [[10, 150], [310, 165], [310, 195], [10, 180]],
                [[710, 185], [810, 190], [810, 220], [710, 215]],
            ],
        },
        1000,
        1000,
    )
    assert [row["lineIndexes"] for row in result["rows"]] == [[0], [1, 2], [3, 4]]
    assert [[segment["text"] for segment in row["segments"]] for row in result["rows"]] == [
        ["EUR"], ["Snack", "0,99"], ["Snack", "0,99"]
    ]
    assert result["lines"][2]["box"] == [0.71, 0.135, 0.81, 0.17]
    assert all("rowCenter" not in line for line in result["lines"])


def test_ocr_rejects_incomplete_or_nonfinite_polygons():
    """Test that OCR rejects incomplete or non-finite polygons."""
    for polygons in [[], [[[0, 0], [10, 0], [10, float("nan")], [0, 10]]]]:
        with pytest.raises(ValueError, match="polygon"):
            shape_ocr_result({
                "rec_texts": ["Snack"],
                "rec_scores": [0.9],
                "rec_boxes": [[0, 0, 10, 10]],
                "rec_polys": polygons,
            }, 100, 100)


@pytest.mark.parametrize("slope", [-0.08, 0.08])
def test_row_grouping_handles_both_directions_of_receipt_tilt(slope):
    """Test that row grouping correctly handles receipts tilted in both directions."""
    polygons = []
    for x, y, width in [(50, 100, 250), (700, 100, 100), (50, 150, 250), (700, 150, 100)]:
        polygons.append([
            [x, y + slope * x], [x + width, y + slope * (x + width)],
            [x + width, y + 25 + slope * (x + width)], [x, y + 25 + slope * x],
        ])
    boxes = [[
        min(point[0] for point in polygon), min(point[1] for point in polygon),
        max(point[0] for point in polygon), max(point[1] for point in polygon),
    ] for polygon in polygons]
    result = shape_ocr_result({
        "rec_texts": ["Snack", "0,99", "Snack", "0,99"],
        "rec_scores": [0.9] * 4,
        "rec_boxes": boxes,
        "rec_polys": polygons,
    }, 1000, 1000)
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1], [2, 3]]
