import pytest
from PIL import Image, ImageDraw

from python_worker.final_image import create_final_images


def test_final_images_use_the_oriented_original_and_keep_separate_outputs(tmp_path):
    """
    Test that the final images use the oriented original and keep separate outputs.

    Args:
        tmp_path (Path): A temporary directory provided by pytest for creating test files.
    """
    original_path = tmp_path / "original.jpg"
    archive_path = tmp_path / "scan" / "archive.webp"
    ocr_path = tmp_path / "scan" / "ocr.webp"
    source = Image.new("RGB", (120, 80), "white")
    ImageDraw.Draw(source).rectangle((0, 0, 119, 39), fill="red")
    exif = Image.Exif()
    exif[274] = 6
    source.save(original_path, exif=exif)

    result = create_final_images(
        original_path,
        {
            "topLeft": [0, 0],
            "topRight": [1, 0],
            "bottomRight": [1, 1],
            "bottomLeft": [0, 1],
        },
        archive_path,
        ocr_path,
    )

    assert result == {"width": 80, "height": 120}
    with Image.open(archive_path) as archive, Image.open(ocr_path) as ocr:
        assert archive.format == "WEBP"
        assert archive.mode == "RGB"
        assert archive.size == (80, 120)
        assert ocr.format == "WEBP"
        assert ocr.size == archive.size
        assert archive.getpixel((60, 60))[1] < archive.getpixel((10, 60))[1]
        assert len(set(ocr.getpixel((60, 60)))) == 1


def test_perspective_transform_crops_to_confirmed_frame(tmp_path):
    """
    Test that the perspective transform correctly crops the image to the confirmed frame.

    Args:
        tmp_path (Path): A temporary directory provided by pytest for creating test files.
    """
    original_path = tmp_path / "original.png"
    archive_path = tmp_path / "archive.webp"
    ocr_path = tmp_path / "ocr.webp"
    source = Image.new("RGB", (200, 300), "blue")
    ImageDraw.Draw(source).polygon(
        [(20, 40), (180, 20), (160, 260), (40, 280)], fill="white"
    )
    source.save(original_path)

    result = create_final_images(
        original_path,
        {
            "topLeft": [20 / 199, 40 / 299],
            "topRight": [180 / 199, 20 / 299],
            "bottomRight": [160 / 199, 260 / 299],
            "bottomLeft": [40 / 199, 280 / 299],
        },
        archive_path,
        ocr_path,
    )

    assert result["width"] > 150
    assert result["height"] > 240
    with Image.open(archive_path) as archive:
        assert archive.size == (result["width"], result["height"])
        assert archive.getpixel((archive.width // 2, archive.height // 2)) == (255, 255, 255)


@pytest.mark.parametrize(
    "corners",
    [
        {"topLeft": [0, 0]},
        {
            "topLeft": [0, 0],
            "topRight": [1.1, 0],
            "bottomRight": [1, 1],
            "bottomLeft": [0, 1],
        },
        {
            "topLeft": [0, 0],
            "topRight": [1, 1],
            "bottomRight": [1, 0],
            "bottomLeft": [0, 1],
        },
    ],
)
def test_invalid_corners_are_rejected_before_writing(tmp_path, corners):
    """
    Test that invalid corner points are rejected before any images are written.

    Args:
        tmp_path (Path): A temporary directory provided by pytest for creating test files.
        corners (dict): A dictionary containing the normalized corner points.
    """
    original_path = tmp_path / "original.png"
    archive_path = tmp_path / "archive.webp"
    ocr_path = tmp_path / "ocr.webp"
    Image.new("RGB", (100, 200), "white").save(original_path)

    with pytest.raises(ValueError, match="corners|topRight"):
        create_final_images(original_path, corners, archive_path, ocr_path)

    assert not archive_path.exists()
    assert not ocr_path.exists()
