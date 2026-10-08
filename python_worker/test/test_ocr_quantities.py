from copy import deepcopy
from types import SimpleNamespace

import pytest
from PIL import Image

from python_worker.ocr import recognize_image, shape_ocr_result
from python_worker.ocr_quantities import separate_quantity_rows


@pytest.fixture
def merged_quantities():
    """Fixture providing a sample OCR result with merged quantities."""
    boxes = [
        [589, 997, 768, 1068], [823, 994, 866, 1114], [32, 1003, 532, 1070],
        [955, 998, 1125, 1060], [32, 1055, 455, 1125],
        [590, 1051, 770, 1122], [957, 1052, 1125, 1113],
    ]
    return {
        "rec_texts": ["0,89 ×", "22", "Product Alpha", "1,78 A", "Product Beta", "0,89 x", "1,78 A"],
        "rec_scores": [0.99] * 7,
        "rec_boxes": boxes,
        "rec_polys": [
            [[591, 997], [768, 1000], [767, 1068], [589, 1064]],
            [[823, 994], [866, 994], [866, 1114], [823, 1114]],
            [[32, 1005], [531, 1003], [532, 1068], [32, 1070]],
            [[955, 998], [1125, 998], [1125, 1060], [955, 1060]],
            [[32, 1060], [454, 1055], [455, 1119], [33, 1125]],
            [[590, 1051], [770, 1051], [770, 1122], [590, 1122]],
            [[957, 1052], [1125, 1052], [1125, 1113], [957, 1113]],
        ],
    }


@pytest.fixture
def image_path(tmp_path):
    """Fixture providing a path to a sample receipt image."""
    path = tmp_path / "receipt.png"
    image = Image.new("RGB", (1217, 3025), (31, 47, 79))
    # Distinct row colors verify that each retry receives its own image region.
    image.paste((91, 113, 137), (823, 994, 866, 1060))
    image.paste((151, 173, 197), (823, 1060, 866, 1114))
    image.save(path)
    return path


class FakeOCR:
    def __init__(self, raw, predictions=None, error=None):
        self.raw = raw
        self.predictions = predictions
        self.error = error
        self.crops = []
        self.paddlex_pipeline = SimpleNamespace(text_rec_model=self.recognize_parts)

    def predict(self, path):
        """Simulate the OCR prediction for the given image path."""
        return [SimpleNamespace(json={"res": self.raw})]

    def recognize_parts(self, crops):
        """Simulate the recognition of individual cropped parts of the image."""
        self.crops.extend(crops)
        if self.error:
            raise self.error
        return self.predictions


def prediction(text, score=0.99):
    """Helper function to create a prediction dictionary for a given text and confidence score."""
    return {"rec_text": text, "rec_score": score}


@pytest.mark.parametrize("digits", ["22", "12"])
def test_recognize_image_assigns_independently_confirmed_digits_to_their_rows(merged_quantities, image_path, digits):
    """Test that recognize_image assigns independently confirmed digits to their respective rows."""
    merged_quantities["rec_texts"][1] = digits
    original = deepcopy(merged_quantities)
    ocr = FakeOCR(merged_quantities, [prediction(digits[0], 0.98), prediction(digits[1], 0.97)])

    result = recognize_image(ocr, image_path)

    assert [[s["text"] for s in row["segments"]] for row in result["rows"]] == [
        ["Product Alpha", "0,89 ×", digits[0], "1,78 A"],
        ["Product Beta", "0,89 x", digits[1], "1,78 A"],
    ]
    assert [row["lineIndexes"] for row in result["rows"]] == [[0, 1, 2, 3], [4, 5, 6, 7]]
    assert result["lines"][2]["box"] == [823 / 1217, 994 / 3025, 866 / 1217, 1060 / 3025]
    assert result["lines"][6]["box"] == [823 / 1217, 1060 / 3025, 866 / 1217, 1114 / 3025]
    assert [result["lines"][i]["confidence"] for i in [2, 6]] == [0.98, 0.97]
    assert len(ocr.crops) == 2
    assert all(crop.ndim == 3 and crop.shape[2] == 3 and crop.size > 0 for crop in ocr.crops)
    assert [tuple(crop[crop.shape[0] // 2, crop.shape[1] // 2]) for crop in ocr.crops] == [
        (137, 113, 91), (197, 173, 151),
    ]
    assert merged_quantities == original


@pytest.mark.parametrize("predictions", [
    [prediction("2"), prediction("2", 0.89)],
    [prediction("2"), prediction("3")],
    [prediction("2"), prediction("22")],
    [prediction("2"), prediction("２")],
    [prediction("2"), prediction("2", float("nan"))],
    [prediction("2"), prediction("2", 1.1)],
    [prediction("2")],
    [{"rec_text": "2"}, prediction("2")],
])
def test_uncertain_or_incomplete_retry_preserves_the_entire_initial_result(merged_quantities, image_path, predictions):
    """Reject changed digits, uncertain scores and malformed batches without partial repair."""
    original = deepcopy(merged_quantities)
    ocr = FakeOCR(merged_quantities, predictions)
    assert recognize_image(ocr, image_path) == shape_ocr_result(original, 1217, 3025)
    assert merged_quantities == original


@pytest.mark.parametrize("error", [OSError("image unavailable"), RuntimeError("recognizer unavailable")])
def test_retry_failure_keeps_the_original_result(merged_quantities, image_path, error):
    """Test that a retry failure keeps the original OCR result intact."""
    ocr = FakeOCR(merged_quantities, error=error)
    assert recognize_image(ocr, image_path) == shape_ocr_result(merged_quantities, 1217, 3025)


def test_unexpected_programming_error_is_not_suppressed(merged_quantities, image_path):
    ocr = FakeOCR(merged_quantities, error=AssertionError("unexpected recognizer state"))
    with pytest.raises(AssertionError, match="unexpected recognizer state"):
        recognize_image(ocr, image_path)


@pytest.mark.parametrize("second_digit", ["4", "5"])
def test_multiple_candidates_keep_their_image_order_and_fall_back_independently(merged_quantities, image_path, second_digit):
    """Test that multiple OCR candidates maintain their image order and fall back independently."""
    raw = merged_quantities
    second = deepcopy(raw)
    second["rec_texts"][1] = "34"
    for box in second["rec_boxes"]:
        box[1] += 300
        box[3] += 300
    for poly in second["rec_polys"]:
        for point in poly:
            point[1] += 300
    # The narrower second candidate is recognized first after aspect-ratio sorting.
    second["rec_boxes"][1][2] = 853
    second["rec_polys"][1] = [[823, 1294], [853, 1294], [853, 1414], [823, 1414]]
    for key in raw:
        raw[key].extend(second[key])
    original = deepcopy(raw)
    ocr = FakeOCR(raw, [prediction("3"), prediction(second_digit), prediction("2"), prediction("2")])

    result = recognize_image(ocr, image_path)

    quantities = [line["text"] for line in result["lines"] if line["text"].isdigit()]
    assert quantities == (["2", "2", "3", "4"] if second_digit == "4" else ["2", "2", "34"])
    assert raw == original


@pytest.mark.parametrize("case", ["horizontal_12", "single_digit", "three_digits", "one_row", "one_sided_row", "three_rows", "outside_image"])
def test_ambiguous_geometry_and_genuine_horizontal_quantities_do_not_trigger_retry(merged_quantities, case):
    """Test that ambiguous geometry and genuine horizontal quantities do not trigger a retry."""
    raw = merged_quantities
    if case == "horizontal_12":
        raw["rec_texts"][1] = "12"
        raw["rec_boxes"][1] = [800, 994, 950, 1054]
    elif case == "single_digit":
        raw["rec_texts"][1] = "2"
    elif case == "three_digits":
        raw["rec_texts"][1] = "123"
    elif case == "one_row":
        for i in [4, 5, 6]:
            raw["rec_texts"][i] = ""
    elif case == "one_sided_row":
        raw["rec_texts"][6] = ""
    elif case == "three_rows":
        raw["rec_texts"].extend(["extra left", "extra right"])
        raw["rec_boxes"].extend([[20, 994, 500, 1006], [950, 994, 1150, 1006]])
    elif case == "outside_image":
        raw["rec_boxes"][1] = [823, -1, 866, 1114]
    ocr = FakeOCR(raw, error=AssertionError("unexpected retry"))
    assert separate_quantity_rows(ocr, raw, "unused.png", 1217, 3025) is raw
    assert ocr.crops == []


def test_initial_invalid_ocr_is_not_hidden_by_repair(merged_quantities, image_path):
    """Test that an initially invalid OCR result is not hidden by the repair process."""
    merged_quantities["rec_scores"].pop()
    ocr = FakeOCR(merged_quantities)
    with pytest.raises(ValueError, match="counts differ"):
        recognize_image(ocr, image_path)
    assert ocr.crops == []
