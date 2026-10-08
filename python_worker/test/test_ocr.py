import sys
from copy import deepcopy
from types import SimpleNamespace

import pytest
from PIL import Image

from python_worker.ocr import initialize_ocr, recognize_image, shape_ocr_result


def test_ocr_lines_are_ordered_indexed_and_normalized():
    """Test that OCR lines are ordered by their position, indexed correctly, and boxes are normalized."""
    result = shape_ocr_result(
        {
            "rec_texts": ["  1,19  ", "TEST MARKET", "MILCH"],
            "rec_scores": [0.91, 0.98, 0.93],
            "rec_boxes": [[90, 80, 210, 100], [20, 10, 100, 30], [10, 80, 80, 100]],
        },
        200,
        100,
    )

    assert result["plainText"] == "TEST MARKET\nMILCH\n1,19"
    assert [line["index"] for line in result["lines"]] == [0, 1, 2]
    assert [line["confidence"] for line in result["lines"]] == [0.98, 0.93, 0.91]
    assert result["lines"][2]["box"] == [0.45, 0.8, 1.0, 1.0]
    assert result["rows"] == [
        {"rowIndex": 0, "segments": [{"text": "TEST MARKET", "x": 0.1}], "lineIndexes": [0]},
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


def test_isolated_quantity_stays_with_its_product_instead_of_the_previous_weight_row():
    """Test that an isolated quantity stays with its product instead of the previous weight row."""
    result = shape_ocr_result({
        "rec_texts": ["0,278 kg × 1,29", "EUR/kg", "Gurken", "0,79 x", "4"],
        "rec_scores": [0.9] * 5,
        "rec_boxes": [
            [79, 409, 509, 477], [537, 403, 712, 473], [32, 459, 201, 528],
            [588, 461, 766, 529], [816, 463, 869, 523],
        ],
        "rec_polys": [
            [[79, 409], [509, 409], [509, 477], [79, 477]],
            [[537, 403], [712, 403], [712, 473], [537, 473]],
            [[33, 459], [201, 462], [200, 528], [32, 525]],
            [[589, 461], [766, 464], [765, 529], [588, 526]],
            [[826, 463], [869, 471], [859, 523], [816, 515]],
        ],
    }, 1217, 3025)

    assert [[segment["text"] for segment in row["segments"]] for row in result["rows"]] == [
        ["0,278 kg × 1,29", "EUR/kg"], ["Gurken", "0,79 x", "4"],
    ]
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1], [2, 3, 4]]
    assert result["lines"][4]["confidence"] == 0.9
    assert result["lines"][4]["box"] == [816 / 1217, 463 / 3025, 869 / 1217, 523 / 3025]


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


@pytest.fixture
def tax_total_with_neighboring_text():
    """Fixture providing a sample OCR result with tax total and neighboring text."""
    return {
        "rec_texts": ["Gesantbetrag", "4,39", "0,23", "4,62", "Referenz:", "SYNTHETIC-REFERENCE-ONLY-FOR-TESTS"],
        "rec_scores": [0.99] * 6,
        "rec_boxes": [
            [64, 1051, 249, 1091], [359, 1055, 427, 1094],
            [565, 1057, 633, 1096], [767, 1057, 836, 1099],
            [65, 1129, 260, 1170], [375, 1135, 864, 1170],
        ],
        "rec_polys": [
            [[64, 1051], [249, 1053], [249, 1091], [64, 1089]],
            [[359, 1055], [427, 1055], [427, 1094], [359, 1094]],
            [[565, 1057], [633, 1057], [633, 1096], [565, 1096]],
            [[767, 1060], [835, 1057], [836, 1096], [769, 1099]],
            [[65, 1129], [260, 1132], [260, 1170], [65, 1168]],
            [[375, 1135], [864, 1137], [864, 1170], [375, 1168]],
        ],
    }


def test_local_tilt_keeps_the_tax_total_with_its_label_and_other_amounts(tax_total_with_neighboring_text):
    """Test that the tax total remains correctly grouped with its label and other amounts after local tilting."""
    raw = tax_total_with_neighboring_text
    original = deepcopy(raw)
    result = shape_ocr_result(raw, 929, 2418)

    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [
        ["Gesantbetrag", "4,39", "0,23", "4,62"],
        ["Referenz:", "SYNTHETIC-REFERENCE-ONLY-FOR-TESTS"],
    ]
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1, 2, 3], [4, 5]]
    assert result["lines"][3]["box"] == [767 / 929, 1057 / 2418, 836 / 929, 1099 / 2418]
    assert all(line["confidence"] == 0.99 for line in result["lines"])
    assert all(set(line) == {"index", "text", "confidence", "box"} for line in result["lines"])
    assert raw == original


@pytest.mark.parametrize("case", ["no_anchors", "one_anchor", "distant_anchors", "empty_anchors"])
def test_missing_local_support_preserves_the_original_amount_geometry(tax_total_with_neighboring_text, case):
    """Test that missing local support does not alter the geometry of the original amount."""
    raw = tax_total_with_neighboring_text
    if case == "no_anchors":
        for key in raw:
            raw[key] = raw[key][1:4]
    elif case == "one_anchor":
        for key in raw:
            raw[key] = raw[key][:4]
    elif case == "distant_anchors":
        for box in raw["rec_boxes"][4:]:
            box[1] += 1000
            box[3] += 1000
        for polygon in raw["rec_polys"][4:]:
            for point in polygon:
                point[1] += 1000
    elif case == "empty_anchors":
        raw["rec_texts"][4:] = ["", " "]
    result = shape_ocr_result(raw, 929, 2418)
    amount_row = next(row for row in result["rows"] if any(s["text"] == "4,62" for s in row["segments"]))
    assert [s["text"] for s in amount_row["segments"]] == ["4,62"]


def test_conflicting_anchor_tilts_cannot_move_a_correctly_grouped_amount():
    """Test that conflicting anchor tilts cannot move a correctly grouped amount."""
    polygons = [
        [[20, 100], [420, 132], [420, 152], [20, 120]],
        [[450, 110], [850, 158], [850, 178], [450, 130]],
        [[880, 140], [940, 140], [940, 160], [880, 160]],
    ]
    boxes = [[min(p[0] for p in polygon), min(p[1] for p in polygon),
              max(p[0] for p in polygon), max(p[1] for p in polygon)] for polygon in polygons]
    result = shape_ocr_result({
        "rec_texts": ["First wide text", "Conflicting wide text", "4,62"],
        "rec_scores": [0.99] * 3, "rec_boxes": boxes, "rec_polys": polygons,
    }, 1000, 400)
    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [
        ["Conflicting wide text"], ["First wide text", "4,62"],
    ]


@pytest.mark.parametrize("slope", [-0.08, 0.08])
def test_local_tilt_preserves_short_prices_on_a_consistently_tilted_receipt(slope):
    """Test that local tilt preserves short prices on a consistently tilted receipt."""
    polygons = []
    for x, y, width in [(50, 120, 400), (800, 120, 60), (50, 170, 400), (800, 170, 60)]:
        polygons.append([
            [x, y + slope * x], [x + width, y + slope * (x + width)],
            [x + width, y + 20 + slope * (x + width)], [x, y + 20 + slope * x],
        ])
    boxes = [[min(p[0] for p in polygon), min(p[1] for p in polygon),
              max(p[0] for p in polygon), max(p[1] for p in polygon)] for polygon in polygons]
    result = shape_ocr_result({
        "rec_texts": ["Snack", "0,99", "Snack", "0,99"],
        "rec_scores": [0.99] * 4, "rec_boxes": boxes, "rec_polys": polygons,
    }, 1000, 400)
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1], [2, 3]]


def test_isolated_total_and_cash_amounts_join_labels_without_merging_change():
    """Test that isolated total and cash amounts join labels without merging changes."""
    raw = {
        "rec_texts": ["€18,40", "Summe", "€25,00", "Bar", "€6,60", "Rückgeld Bar"],
        "rec_scores": [0.99] * 6,
        "rec_boxes": [
            [1003, 1356, 1404, 1441], [38, 1393, 363, 1462],
            [1145, 1693, 1303, 1755], [37, 1723, 115, 1782],
            [1165, 1745, 1300, 1806], [37, 1769, 329, 1833],
        ],
        "rec_polys": [
            [[1003, 1361], [1402, 1356], [1404, 1436], [1004, 1441]],
            [[38, 1393], [363, 1393], [363, 1462], [38, 1462]],
            [[1145, 1693], [1303, 1693], [1303, 1755], [1145, 1755]],
            [[37, 1723], [115, 1723], [115, 1782], [37, 1782]],
            [[1165, 1747], [1299, 1745], [1300, 1804], [1166, 1806]],
            [[37, 1773], [328, 1769], [329, 1829], [37, 1833]],
        ],
    }
    original = deepcopy(raw)
    result = shape_ocr_result(raw, 1466, 3456)

    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [
        ["Summe", "€18,40"], ["Bar", "€25,00"], ["Rückgeld Bar", "€6,60"],
    ]
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1], [2, 3], [4, 5]]
    assert sorted((line["text"], line["confidence"]) for line in result["lines"]) == sorted(zip(raw["rec_texts"], raw["rec_scores"]))
    assert raw == original


@pytest.mark.parametrize(("amount", "label_offset"), [
    ("18,40", -28), ("18,40", 28),
    ("€18,40", 28), ("18.40 €", 28), ("-18,40", 28), ("€−18,40", 28),
])
def test_isolated_amount_pair_handles_both_vertical_orders_and_amount_formats(amount, label_offset):
    """Test that isolated amount pairs are correctly handled regardless of vertical order and amount formats."""
    result = shape_ocr_result({
        "rec_texts": ["Total", amount], "rec_scores": [0.99, 0.99],
        "rec_boxes": [[40, 100 + label_offset, 200, 160 + label_offset], [800, 100, 900, 160]],
    }, 1000, 300)

    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [["Total", amount]]


@pytest.mark.parametrize("case", ["header", "identifier", "tax_code", "numeric_label", "same_side", "too_far", "no_vertical_overlap"])
def test_isolated_row_join_preserves_unrelated_or_insufficiently_supported_segments(case):
    """Test that isolated row join preserves unrelated or insufficiently supported segments."""
    texts = ["Total", "€18,40"]
    boxes = [[40, 128, 200, 188], [800, 100, 900, 160]]
    if case == "header":
        texts[1] = "Exampletown"
    elif case == "identifier":
        texts[1] = "000000000042"
    elif case == "tax_code":
        texts[1] = "18,401"
    elif case == "numeric_label":
        texts[0] = "42"
    elif case == "same_side":
        boxes[1] = [300, 100, 400, 160]
    elif case == "too_far":
        boxes[0] = [40, 135, 200, 195]
    elif case == "no_vertical_overlap":
        boxes[0] = [40, 170, 200, 230]
    result = shape_ocr_result({"rec_texts": texts, "rec_scores": [0.99, 0.99], "rec_boxes": boxes}, 1000, 300)

    assert len(result["rows"]) == 2


@pytest.mark.parametrize("boxes", [
    [[40, 100, 200, 160], [800, 125, 900, 185], [40, 150, 200, 210]],
    [[40, 129, 200, 139], [800, 100, 900, 160], [40, 128, 200, 148]],
])
def test_competing_labels_prevent_an_amount_from_being_assigned_arbitrarily(boxes):
    """Test that competing labels prevent an amount from being assigned arbitrarily."""
    result = shape_ocr_result({
        "rec_texts": ["First label", "€18,40", "Second label"],
        "rec_scores": [0.99] * 3, "rec_boxes": boxes,
    }, 1000, 300)

    assert len(result["rows"]) == 3


def test_isolated_amount_is_not_joined_to_a_row_already_containing_multiple_segments():
    """Test that an isolated amount is not joined to a row already containing multiple segments."""
    result = shape_ocr_result({
        "rec_texts": ["First label", "Other label", "€18,40"],
        "rec_scores": [0.99] * 3,
        "rec_boxes": [[40, 128, 200, 188], [250, 128, 400, 188], [800, 100, 900, 160]],
    }, 1000, 300)

    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [
        ["€18,40"], ["First label", "Other label"],
    ]
