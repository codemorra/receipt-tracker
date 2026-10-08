from copy import deepcopy
from types import SimpleNamespace

import cv2
import pytest
from PIL import Image, ImageDraw

from python_worker.ocr import recognize_image, shape_ocr_result
from python_worker.ocr_price_markers import separate_price_markers


def prediction(text, score=0.95):
    """Create a prediction dictionary with the given text and score."""
    return {"rec_text": text, "rec_score": score}


class FakeOCR:
    def __init__(self, raw, predictions=None, error=None):
        self.raw = raw
        self.predictions = predictions
        self.error = error
        self.crops = []
        self.paddlex_pipeline = SimpleNamespace(text_rec_model=self.recognize)

    def predict(self, path):
        """Simulate the prediction step of the OCR model."""
        return [SimpleNamespace(json={"res": self.raw})]

    def recognize(self, crops):
        """Simulate the recognition step of the OCR model."""
        self.crops.extend(crops)
        if self.error:
            raise self.error
        return self.predictions


@pytest.fixture
def sample(tmp_path):
    """Provide a sample OCR result and corresponding image path for testing."""
    boxes = [[40, 100, 400, 160], [600, 100, 800, 160], [40, 240, 300, 300]]
    raw = {
        "rec_texts": ["2x 0,95 Example product", "1,901", "1=19,00%"],
        "rec_scores": [0.99] * 3, "rec_boxes": boxes,
        "rec_polys": [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]] for x1, y1, x2, y2 in boxes],
    }
    image = Image.new("RGB", (1000, 400), "white")
    draw = ImageDraw.Draw(image)
    for x in [610, 640, 665, 694, 780]:
        draw.rectangle((x, 110, x + 8, 150), fill="black")
    path = tmp_path / "receipt.png"
    image.save(path)
    return raw, path


@pytest.mark.parametrize("with_polygons", [True, False])
def test_price_and_marker_are_separated_only_after_both_crop_reads_confirm_them(sample, with_polygons):
    """Test that price and marker are separated only after both crop reads confirm them."""
    raw, path = sample
    if not with_polygons:
        raw.pop("rec_polys")
    original = deepcopy(raw)
    ocr = FakeOCR(raw, [prediction("1"), prediction("1,90", 0.97)])

    result = recognize_image(ocr, path)

    assert [s["text"] for s in result["rows"][0]["segments"]] == ["2x 0,95 Example product", "1,90", "1"]
    assert [line["text"] for line in result["lines"]] == ["2x 0,95 Example product", "1,90", "1", "1=19,00%"]
    assert result["lines"][1]["confidence"] == 0.97
    assert result["lines"][2]["confidence"] == 0.95
    assert result["lines"][1]["box"][2] == result["lines"][2]["box"][0]
    assert result["lines"][1]["box"][:2] == [0.6, 0.25]
    assert result["lines"][2]["box"][2:] == [0.8, 0.4]
    assert len(ocr.crops) == 2
    assert ocr.crops[0].shape[1] < ocr.crops[1].shape[1]
    assert tuple(ocr.crops[0][0, 0]) == (255, 255, 255)
    assert raw == original


@pytest.mark.parametrize("case", ["no_legend", "other_marker", "weight", "already_separate", "left_half", "outside_image"])
def test_no_supported_price_marker_candidate_does_not_read_image_or_call_model(sample, case):
    """Test that no supported price marker candidate does not trigger image reading or model calls."""
    raw, _path = sample
    if case == "no_legend":
        raw["rec_texts"][2] = "19,00%"
    elif case == "other_marker":
        raw["rec_texts"][2] = "2=7,00%"
    elif case == "weight":
        raw["rec_texts"][1] = "0,321 kg"
    elif case == "already_separate":
        raw["rec_texts"][1] = "1,90 1"
    elif case == "left_half":
        raw["rec_boxes"][1] = [40, 100, 240, 160]
    elif case == "outside_image":
        raw["rec_boxes"][1][2] = 1001
    ocr = FakeOCR(raw, error=AssertionError("Unexpected crop recognition"))

    assert separate_price_markers(ocr, raw, "unused.png", 1000, 400) is raw
    assert not ocr.crops


@pytest.mark.parametrize("case", ["blank", "normal_digit_spacing", "two_large_gaps", "wide_trailing_field", "narrow_price"])
def test_missing_unique_large_gap_preserves_three_decimal_values(sample, case):
    """Test that missing a unique large gap preserves three decimal values."""
    raw, path = sample
    image = Image.new("RGB", (1000, 400), "white")
    draw = ImageDraw.Draw(image)
    positions = {
        "blank": [], "normal_digit_spacing": [610, 640, 670, 700, 730, 760, 790],
        "two_large_gaps": [610, 680, 790], "wide_trailing_field": [610, 620, 630, 770, 790],
        "narrow_price": [610, 680, 690, 700, 710, 720, 730, 740, 750, 760, 770, 780, 790],
    }[case]
    for x in positions:
        draw.rectangle((x, 110, x + 8, 150), fill="black")
    image.save(path)
    ocr = FakeOCR(raw, error=AssertionError("Unexpected crop recognition"))

    assert separate_price_markers(ocr, raw, path, 1000, 400) is raw
    assert not ocr.crops


@pytest.mark.parametrize("predictions", [
    [prediction("2"), prediction("1,90")],
    [prediction("1"), prediction("1,99")],
    [prediction("1"), prediction("1,901")],
    [prediction("1"), prediction("1.90")],
    [prediction(None), prediction("1,90")],
    [prediction("1", 0.89), prediction("1,90")],
    [prediction("1"), prediction("1,90", 0.89)],
    [prediction("1"), prediction("1,90", float("nan"))],
    [prediction("1", 1.01), prediction("1,90")],
    [prediction("1", "invalid"), prediction("1,90")],
    [prediction("1"), {}], [],
])
def test_uncertain_or_changed_crop_reads_retain_original_result(sample, predictions):
    """Test that uncertain or changed crop reads retain the original OCR result."""
    raw, path = sample
    original = deepcopy(raw)
    ocr = FakeOCR(raw, predictions)

    assert recognize_image(ocr, path) == shape_ocr_result(raw, 1000, 400)
    assert raw == original


# ValueError and KeyError are already exercised by malformed predictions above.
@pytest.mark.parametrize("error_type", [OSError, RuntimeError, TypeError, cv2.error])
def test_expected_crop_failure_retains_original_result(sample, error_type):
    """Test that expected crop failures retain the original OCR result."""
    raw, path = sample
    ocr = FakeOCR(raw, error=error_type("Unavailable crop"))

    assert separate_price_markers(ocr, raw, path, 1000, 400) is raw


def test_unexpected_programming_error_is_not_silenced(sample):
    """Test that unexpected programming errors are not silenced."""
    raw, path = sample
    ocr = FakeOCR(raw, error=AssertionError("Unexpected recognizer state"))

    with pytest.raises(AssertionError, match="Unexpected recognizer state"):
        recognize_image(ocr, path)


def test_missing_image_preserves_initial_ocr(sample):
    """Test that a missing image preserves the initial OCR result."""
    raw, _path = sample
    assert separate_price_markers(FakeOCR(raw), raw, "missing.png", 1000, 400) is raw


def test_multiple_prices_are_confirmed_independently_with_batch_order_restored(sample):
    """Test that multiple prices are confirmed independently and the batch order is restored."""
    raw, path = sample
    original = deepcopy(raw)
    for key in raw:
        value = deepcopy(raw[key][1])
        if key == "rec_texts":
            value = "2,501"
        elif key == "rec_boxes":
            value[1] += 80
            value[3] += 80
        elif key == "rec_polys":
            for point in value:
                point[1] += 80
        raw[key].append(value)
    with Image.open(path) as image:
        crop = image.crop(original["rec_boxes"][1])
        image.paste(crop, (600, 180))
        image.save(path)
    ocr = FakeOCR(raw, [prediction("1"), prediction("1"), prediction("1,90"), prediction("2,59")])
    before = deepcopy(raw)

    repaired = separate_price_markers(ocr, raw, path, 1000, 400)

    assert repaired["rec_texts"] == ["2x 0,95 Example product", "1,90", "1", "1=19,00%", "2,501"]
    assert repaired["rec_boxes"][-1] == raw["rec_boxes"][-1]
    assert len(ocr.crops) == 4
    assert raw == before
