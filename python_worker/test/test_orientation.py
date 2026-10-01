import sys
from types import SimpleNamespace

import numpy
import pytest
from PIL import Image, ImageDraw

from python_worker import orientation
from python_worker.final_image import create_final_images
from python_worker.preview import create_preview, default_corners


@pytest.mark.parametrize("error_type", [ImportError, OSError, RuntimeError, ValueError])
def test_expected_initialization_failures_leave_manual_orientation_available(monkeypatch, error_type):
    """Test that expected initialization failures leave manual orientation available."""
    def initialize(**options):
        raise error_type("Model unavailable")

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(DocImgOrientationClassification=initialize))
    orientation.initialize_orientation.cache_clear()
    try:
        assert orientation.initialize_orientation() is None
    finally:
        orientation.initialize_orientation.cache_clear()


def test_unexpected_initialization_errors_are_not_silently_ignored(monkeypatch):
    """Test that unexpected initialization errors are not silently ignored."""
    def initialize(**options):
        raise TypeError("Invalid constructor arguments")

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(DocImgOrientationClassification=initialize))
    orientation.initialize_orientation.cache_clear()
    try:
        with pytest.raises(TypeError, match="Invalid constructor arguments"):
            orientation.initialize_orientation()
    finally:
        orientation.initialize_orientation.cache_clear()


@pytest.mark.parametrize("angle,rotation", [(0, 0), (90, 270), (180, 180), (270, 90)])
def test_orientation_prediction_returns_clockwise_correction(monkeypatch, angle, rotation):
    """Test that the orientation prediction returns the correct clockwise rotation."""
    class Model:
        def predict(self, pixels):
            assert pixels[0, 0].tolist() == [30, 20, 10]
            return [SimpleNamespace(json={"res": {"label_names": [str(angle)], "scores": [0.95]}})]

    monkeypatch.setattr(orientation, "initialize_orientation", lambda: Model())

    assert orientation.detect_rotation(Image.new("RGB", (100, 200), (10, 20, 30))) == rotation


@pytest.mark.parametrize("score,angle", [(0.5, "90"), (float("nan"), "90"), (0.99, "45")])
def test_uncertain_or_invalid_prediction_preserves_orientation(monkeypatch, score, angle):
    """Test that uncertain or invalid orientation predictions preserve the original orientation."""
    model = SimpleNamespace(predict=lambda pixels: [
        SimpleNamespace(json={"res": {"label_names": [angle], "scores": [score]}})
    ])
    monkeypatch.setattr(orientation, "initialize_orientation", lambda: model)

    assert orientation.detect_rotation(Image.new("RGB", (100, 200), "white")) == 0


def test_missing_or_failed_model_preserves_orientation(monkeypatch):
    """Test that a missing or failed orientation model preserves the original orientation."""
    monkeypatch.setattr(orientation, "initialize_orientation", lambda: None)
    image = Image.new("RGB", (100, 200), "white")
    assert orientation.detect_rotation(image) == 0

    class Model:
        def predict(self, pixels):
            raise RuntimeError("Prediction failed")

    monkeypatch.setattr(orientation, "initialize_orientation", lambda: Model())
    assert orientation.detect_rotation(image) == 0


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_preview_and_final_images_use_the_same_selected_orientation(tmp_path, rotation):
    """Test that the preview and final images use the same selected orientation."""
    image = Image.new("RGB", (120, 200), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((5, 5, 30, 30), fill="red")
    draw.rectangle((90, 5, 115, 30), fill="green")
    draw.rectangle((90, 170, 115, 195), fill="blue")
    draw.rectangle((5, 170, 30, 195), fill="yellow")
    source = image
    if rotation:
        source = image.transpose({
            90: Image.Transpose.ROTATE_90,
            180: Image.Transpose.ROTATE_180,
            270: Image.Transpose.ROTATE_270,
        }[rotation])
    original = tmp_path / "original.png"
    source.save(original)
    original_bytes = original.read_bytes()
    preview = tmp_path / "preview.webp"
    archive = tmp_path / "archive.webp"
    ocr = tmp_path / "ocr.webp"
    result = create_preview(original, preview, lambda receipt: rotation)

    assert result["rotation"] == rotation
    assert (result["width"], result["height"]) == (120, 200)
    assert result["suggestedCorners"] == default_corners()
    final = create_final_images(original, result["suggestedCorners"], archive, ocr, rotation)
    assert final == {"width": 120, "height": 200}
    with Image.open(preview) as preview_image, Image.open(archive) as archive_image, Image.open(ocr) as ocr_image:
        for point, channel in [((15, 15), 0), ((100, 15), 1), ((100, 180), 2)]:
            assert numpy.argmax(preview_image.getpixel(point)) == channel
            assert numpy.argmax(archive_image.getpixel(point)) == channel
        assert preview_image.size == archive_image.size == ocr_image.size
        assert ocr_image.getpixel((15, 15)) > ocr_image.getpixel((100, 180))
    assert original.read_bytes() == original_bytes


def test_rotation_moves_adjusted_corners_with_the_image():
    """Test that the rotation correctly moves the adjusted corners with the image."""
    corners = {
        "topLeft": [0.1, 0.2], "topRight": [0.8, 0.15],
        "bottomRight": [0.85, 0.9], "bottomLeft": [0.2, 0.8],
    }
    rotated = orientation.rotate_corners(corners, 90)
    expected = {
        "topLeft": [0.2, 0.2], "topRight": [0.8, 0.1],
        "bottomRight": [0.85, 0.8], "bottomLeft": [0.1, 0.85],
    }
    for name, value in corners.items():
        assert rotated[name] == pytest.approx(expected[name])
        assert orientation.rotate_corners(rotated, 270)[name] == pytest.approx(value)


@pytest.mark.parametrize("rotation", [-90, 45, 360, True, "90", 90.0, None])
def test_invalid_final_rotation_is_rejected_before_writing(tmp_path, rotation):
    """Test that an invalid final rotation is rejected before writing the final images."""
    original = tmp_path / "original.png"
    archive = tmp_path / "archive.webp"
    ocr = tmp_path / "ocr.webp"
    Image.new("RGB", (100, 200), "white").save(original)

    with pytest.raises(ValueError, match="rotation"):
        create_final_images(original, default_corners(), archive, ocr, rotation)
    assert not archive.exists()
    assert not ocr.exists()


def test_exif_correction_precedes_selected_rotation_for_all_outputs(tmp_path):
    """Test that EXIF-based orientation correction is applied before the selected rotation for all output images."""
    original = tmp_path / "original.jpg"
    image = Image.new("RGB", (120, 80), "blue")
    ImageDraw.Draw(image).rectangle((0, 0, 119, 39), fill="red")
    exif = Image.Exif()
    exif[274] = 6
    image.save(original, exif=exif, quality=100)
    preview = tmp_path / "preview.webp"
    archive = tmp_path / "archive.webp"
    ocr = tmp_path / "ocr.webp"

    result = create_preview(original, preview, lambda receipt: 90)
    assert (result["width"], result["height"]) == (120, 80)
    create_final_images(original, result["suggestedCorners"], archive, ocr, result["rotation"])
    with Image.open(preview) as preview_image, Image.open(archive) as archive_image:
        for output in (preview_image, archive_image):
            assert output.size == (120, 80)
            assert output.getpixel((60, 20))[2] > 200
            assert output.getpixel((60, 60))[0] > 200


def test_manual_override_replaces_the_automatic_rotation(tmp_path):
    """Test that a manual rotation override replaces the automatic rotation for the final images."""
    original = tmp_path / "original.png"
    image = Image.new("RGB", (200, 120), "white")
    ImageDraw.Draw(image).rectangle((5, 90, 30, 115), fill="red")
    image.save(original)
    preview = create_preview(original, tmp_path / "preview.webp", lambda receipt: 90)
    selected_corners = orientation.rotate_corners(preview["suggestedCorners"], 270)
    archive = tmp_path / "archive.webp"

    result = create_final_images(original, selected_corners, archive, tmp_path / "ocr.webp", 0)

    assert result == {"width": 200, "height": 120}
    with Image.open(archive) as output:
        assert output.getpixel((15, 105))[0] > 200
        assert output.getpixel((15, 105))[1] < 50
