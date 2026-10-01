from hashlib import sha256
from pathlib import Path

import numpy
import pytest
from PIL import Image, ImageDraw

from python_worker.preview import create_preview, default_corners, suggested_corners


@pytest.mark.parametrize(
    "points",
    [
        [(50, 70), (350, 70), (350, 530), (50, 530)],
        [(40, 160), (360, 160), (360, 400), (40, 400)],
        [(70, 80), (350, 110), (310, 510), (40, 530)],
        [(180, 60), (350, 160), (220, 540), (50, 440)],
    ],
)
def test_detects_receipt_corners_on_neutral_background(points):
    """Test that the suggested corners are correctly detected for a receipt on a neutral background."""
    image = Image.new("RGB", (400, 600), "gray")
    ImageDraw.Draw(image).polygon(points, fill="white")

    corners = suggested_corners(image)

    for name, (x, y) in zip(default_corners(), points):
        assert corners[name] == pytest.approx([x / 400, y / 600], abs=0.015)


@pytest.mark.parametrize("background", ["checker", "texture"])
def test_detects_paper_on_structured_background(background):
    """Test that the suggested corners are correctly detected for a receipt on a structured background."""
    pixels = numpy.empty((800, 600, 3), dtype=numpy.uint8)
    if background == "checker":
        rows, columns = numpy.indices((800, 600))
        squares = (rows // 60 + columns // 60) % 2
        pixels[squares == 0] = [135, 35, 65]
        pixels[squares == 1] = [155, 150, 115]
    else:
        noise = numpy.random.default_rng(0).integers(-25, 26, (800, 600, 1))
        pixels[:] = numpy.clip(numpy.array([125, 115, 100]) + noise, 0, 255)
    image = Image.fromarray(pixels)
    draw = ImageDraw.Draw(image)
    points = [(170, 80), (440, 100), (420, 720), (150, 700)]
    draw.polygon(points, fill=(195, 197, 200))
    for y in range(130, 680, 20):
        draw.line((200, y, 380, y), fill=(85, 85, 85), width=2)

    corners = suggested_corners(image)

    for name, (x, y) in zip(default_corners(), points):
        assert corners[name] == pytest.approx([x / 600, y / 800], abs=0.015)


def test_preserves_edge_detection_for_a_colored_receipt():
    """Test that the suggested corners are correctly detected for a colored receipt on a neutral background."""
    image = Image.new("RGB", (400, 600), (80, 80, 80))
    ImageDraw.Draw(image).rectangle((50, 70, 350, 530), fill=(210, 150, 100))

    corners = suggested_corners(image)

    assert corners["topLeft"] == pytest.approx([0.125, 70 / 600], abs=0.015)
    assert corners["bottomRight"] == pytest.approx([0.875, 530 / 600], abs=0.015)


@pytest.mark.parametrize("background", ["white", "gray", "black"])
def test_uniform_image_uses_default_frame(background):
    """Test that a uniform image uses the default receipt corners."""
    assert suggested_corners(Image.new("RGB", (400, 600), background)) == default_corners()


@pytest.mark.parametrize(
    "points",
    [
        [(0, 70), (350, 70), (350, 530), (0, 530)],
        [(80, 90), (320, 90), (200, 500)],
        [(150, 250), (250, 250), (250, 350), (150, 350)],
    ],
)
def test_rejects_border_contours_triangles_and_small_objects(points):
    """Test that border contours, triangles, and small objects are rejected and the default corners are used."""
    image = Image.new("RGB", (400, 600), "gray")
    ImageDraw.Draw(image).polygon(points, fill="white")

    assert suggested_corners(image) == default_corners()


def test_preview_coordinates_follow_exif_orientation_without_changing_original(tmp_path):
    """Test that the preview coordinates follow the EXIF orientation without changing the original image."""
    original = tmp_path / "original.jpg"
    preview = tmp_path / "preview.webp"
    image = Image.new("RGB", (600, 400), "gray")
    ImageDraw.Draw(image).rectangle((70, 50, 530, 350), fill="white")
    exif = Image.Exif()
    exif[274] = 6
    image.save(original, exif=exif)
    original_hash = sha256(original.read_bytes()).digest()

    result = create_preview(original, preview)

    assert (result["width"], result["height"]) == (400, 600)
    assert result["suggestedCorners"]["topLeft"] == pytest.approx([0.125, 70 / 600], abs=0.015)
    assert result["suggestedCorners"]["bottomRight"] == pytest.approx([0.875, 530 / 600], abs=0.015)
    with Image.open(preview) as image:
        assert image.format == "WEBP"
        assert image.size == (400, 600)
    assert sha256(original.read_bytes()).digest() == original_hash


@pytest.mark.parametrize(
    "name,expected",
    [
        ("big_1", [(0.320, 0.152), (0.706, 0.166), (0.705, 0.908), (0.304, 0.912)]),
        ("big_2", [(0.088, 0.307), (0.908, 0.310), (0.908, 0.687), (0.091, 0.686)]),
        ("big_3", [(0.272, 0.282), (0.752, 0.282), (0.769, 0.729), (0.266, 0.717)]),
    ],
)
def test_local_receipt_photos_match_reference_corners(tmp_path, name, expected):
    """Test that local receipt photos match the reference corners."""
    original = Path(__file__).resolve().parents[2] / ".local" / "bons" / f"{name}.jpg"
    if not original.exists():
        pytest.skip("Local receipt photo is not available")
    original_hash = sha256(original.read_bytes()).digest()

    result = create_preview(original, tmp_path / f"{name}.webp")

    for corner, point in zip(default_corners(), expected):
        assert result["suggestedCorners"][corner] == pytest.approx(point, abs=0.015)
    assert sha256(original.read_bytes()).digest() == original_hash
