from copy import deepcopy
from types import SimpleNamespace

import pytest
from PIL import Image

from python_worker.ocr import recognize_image, shape_ocr_result
from python_worker.ocr_overlaps import merge_quantity_fragments


@pytest.fixture
def overlapping_quantity():
    """Fixture providing an overlapping quantity scenario for testing OCR overlaps."""
    boxes = [[33, 917, 442, 963], [450, 915, 580, 961], [559, 912, 656, 961], [718, 912, 852, 955]]
    return {
        "rec_texts": ["Gewürzgurken Auslese", "1,19 x", "x 6", "7,14 A"],
        "rec_scores": [0.99, 0.998, 0.807, 0.99],
        "rec_boxes": boxes,
        "rec_polys": [
            [[33, 919], [442, 917], [442, 961], [34, 963]],
            [[450, 915], [580, 915], [580, 961], [450, 961]],
            [[559, 912], [656, 912], [656, 961], [559, 961]],
            [[718, 912], [852, 912], [852, 955], [718, 955]],
        ],
    }


@pytest.fixture
def image_path(tmp_path):
    """Fixture providing a temporary image path for testing OCR overlaps."""
    path = tmp_path / "receipt.png"
    Image.new("RGB", (884, 2815), (31, 47, 79)).save(path)
    return path


class FakeOCR:
    def __init__(self, raw, predictions=None, error=None):
        self.raw = raw
        self.predictions = predictions
        self.error = error
        self.crops = []
        self.paddlex_pipeline = SimpleNamespace(text_rec_model=self.recognize_crop)

    def predict(self, path):
        """Simulate the OCR prediction for the given image path."""
        return [SimpleNamespace(json={"res": self.raw})]

    def recognize_crop(self, crops):
        """Simulate the OCR recognition for cropped image regions."""
        self.crops.extend(crops)
        if self.error:
            raise self.error
        return self.predictions


def prediction(text, score=0.95):
    """Create a prediction dictionary for the given text and confidence score."""
    return {"rec_text": text, "rec_score": score}


@pytest.mark.parametrize("text", ["1,19 x 6", "1.19 × 6"])
@pytest.mark.parametrize("reverse", [False, True])
def test_only_image_confirmed_fragments_are_merged(overlapping_quantity, image_path, text, reverse):
    """Test that only image-confirmed fragments are merged in the OCR result."""
    raw = overlapping_quantity
    if reverse:
        for values in raw.values():
            values[1], values[2] = values[2], values[1]
    original = deepcopy(raw)
    ocr = FakeOCR(raw, [prediction(text)])

    result = recognize_image(ocr, image_path)

    assert result["plainText"] == f"Gewürzgurken Auslese\n{text}\n7,14 A"
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1, 2]]
    assert result["rows"][0]["segments"][1]["text"] == text
    assert result["lines"][1]["box"] == [450 / 884, 912 / 2815, 656 / 884, 961 / 2815]
    assert result["lines"][1]["confidence"] == 0.95
    assert result["lines"][0] == shape_ocr_result(original, 884, 2815)["lines"][0]
    assert result["lines"][2]["text"] == "7,14 A"
    assert len(ocr.crops) == 1
    assert ocr.crops[0].shape == (55, 212, 3)
    assert tuple(ocr.crops[0][0, 0]) == (255, 255, 255)
    assert tuple(ocr.crops[0][3, 3]) == (79, 47, 31)
    assert raw == original


@pytest.mark.parametrize("predictions", [
    [prediction("1,19 x 8")],
    [prediction("1,99 x 6")],
    [prediction("1,19 x 66")],
    [prediction("1,19 x 6 A")],
    [prediction("1,19 x x 6")],
    [prediction("x 6")],
    [prediction("")],
    [prediction(None)],
    [prediction("1,19 x 6", 0.89)],
    [prediction("1,19 x 6", float("nan"))],
    [prediction("1,19 x 6", float("inf"))],
    [prediction("1,19 x 6", 1.1)],
    [{"rec_text": "1,19 x 6"}],
    [],
    [prediction("1,19 x 6"), prediction("1,19 x 6")],
])
def test_uncertain_recognition_retains_both_original_fragments(overlapping_quantity, image_path, predictions):
    """Test that uncertain OCR predictions retain both original fragments in the result."""
    raw = overlapping_quantity
    original = deepcopy(raw)
    ocr = FakeOCR(raw, predictions)
    assert recognize_image(ocr, image_path) == shape_ocr_result(original, 884, 2815)
    assert raw == original


@pytest.mark.parametrize("case", ["no_overlap", "different_rows", "insufficient_overlap", "contained", "quantity_12", "tax_header", "ambiguous_quantity", "ambiguous_price", "outside_image"])
def test_geometry_or_other_text_cannot_trigger_a_generic_merge(overlapping_quantity, case):
    """Test that geometry or other text cannot trigger a generic merge of OCR fragments."""
    raw = overlapping_quantity
    if case == "no_overlap":
        raw["rec_boxes"][2] = [590, 912, 656, 961]
    elif case == "different_rows":
        raw["rec_boxes"][2] = [559, 980, 656, 1029]
    elif case == "insufficient_overlap":
        raw["rec_boxes"][2] = [578, 912, 656, 961]
    elif case == "contained":
        raw["rec_boxes"][2] = [559, 912, 570, 961]
    elif case == "quantity_12":
        raw["rec_texts"][2] = "12"
    elif case == "tax_header":
        raw["rec_texts"][1:3] = ["NETTO", "MWST-BETRAG BRUTTO"]
    elif case in ["ambiguous_quantity", "ambiguous_price"]:
        index = 2 if case == "ambiguous_quantity" else 1
        for values in raw.values():
            values.append(deepcopy(values[index]))
    elif case == "outside_image":
        raw["rec_boxes"][2][2] = 1000
    ocr = FakeOCR(raw, error=AssertionError("unexpected retry"))
    assert merge_quantity_fragments(ocr, raw, "unused.png", 884, 2815) is raw
    assert ocr.crops == []


@pytest.mark.parametrize("error", [OSError("image unavailable"), RuntimeError("recognizer unavailable")])
def test_expected_retry_errors_keep_the_initial_result(overlapping_quantity, image_path, error):
    """Test that expected retry errors do not alter the initial OCR result."""
    ocr = FakeOCR(overlapping_quantity, error=error)
    assert recognize_image(ocr, image_path) == shape_ocr_result(overlapping_quantity, 884, 2815)


def test_programming_errors_are_not_suppressed(overlapping_quantity, image_path):
    """Test that programming errors are not suppressed during OCR recognition."""
    ocr = FakeOCR(overlapping_quantity, error=AssertionError("unexpected recognizer state"))
    with pytest.raises(AssertionError, match="unexpected recognizer state"):
        recognize_image(ocr, image_path)


def test_multiple_pairs_are_confirmed_independently(overlapping_quantity, image_path):
    """Test that multiple overlapping quantity pairs are confirmed independently in the OCR result."""
    raw = overlapping_quantity
    second = deepcopy(raw)
    second["rec_texts"][1:3] = ["2,49 x", "x 12"]
    for box in second["rec_boxes"]:
        box[1] += 300
        box[3] += 300
    for polygon in second["rec_polys"]:
        for point in polygon:
            point[1] += 300
    for key in raw:
        raw[key].extend(second[key])
    ocr = FakeOCR(raw, [prediction("1,19 x 6"), prediction("2,49 x 13")])
    result = recognize_image(ocr, image_path)
    assert [line["text"] for line in result["lines"]] == [
        "Gewürzgurken Auslese", "1,19 x 6", "7,14 A",
        "Gewürzgurken Auslese", "2,49 x", "x 12", "7,14 A",
    ]
