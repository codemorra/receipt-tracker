import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

WORKER_DIRECTORY = Path(__file__).resolve().parents[1]


def run_worker(requests, extra_env=None):
    """Run the worker with the given requests and return the result.

    Args:
        requests (list): A list of request dictionaries to send to the worker.
        extra_env (dict, optional): Additional environment variables to set for the worker process.

    Returns:
        subprocess.CompletedProcess: The result of running the worker.
    """
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join([
        str(WORKER_DIRECTORY / "test" / "fixtures"),
        str(WORKER_DIRECTORY.parent),
        environment.get("PYTHONPATH", ""),
    ])
    environment.update(extra_env or {})
    return subprocess.run(
        [sys.executable, "-m", "python_worker.worker"],
        input="".join(json.dumps(request) + "\n" for request in requests),
        text=True,
        capture_output=True,
        check=True,
        cwd=WORKER_DIRECTORY.parent,
        env=environment,
    )


def test_protocol_keeps_worker_alive_after_failed_request(tmp_path):
    """Test that the worker remains alive after a failed request.

    Args:
        tmp_path (Path): A temporary directory provided by pytest.
    """
    original = tmp_path / "original.png"
    preview = tmp_path / "preview.webp"
    Image.new("RGB", (100, 200), "white").save(original)
    result = run_worker([
        {"requestId": "bad", "type": "preview", "originalPath": str(tmp_path / "missing.png"), "previewPath": str(preview)},
        {"requestId": "good", "type": "preview", "originalPath": str(original), "previewPath": str(preview)},
    ])

    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert messages[0] == {"type": "ready"}
    assert messages[1]["requestId"] == "bad"
    assert messages[1]["status"] == "error"
    assert messages[2]["requestId"] == "good"
    assert messages[2]["status"] == "ok"
    assert (messages[2]["width"], messages[2]["height"]) == (100, 200)
    with Image.open(preview) as image:
        assert image.format == "WEBP"
    assert "Traceback" in result.stderr
    assert result.stderr.count("PaddleOCR initialized") == 1
    assert result.stderr.count("Native OCR initialization log") == 1


def test_orientation_and_normalized_corners(tmp_path):
    """Test that the worker correctly handles image orientation and returns normalized corners.

    Args:
        tmp_path (Path): A temporary directory provided by pytest.
    """
    original = tmp_path / "original.jpg"
    preview = tmp_path / "preview.webp"
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (120, 80), "white").save(original, exif=exif)
    result = run_worker([
        {"requestId": "rotate", "type": "preview", "originalPath": str(original), "previewPath": str(preview)}
    ])

    message = json.loads(result.stdout.splitlines()[1])
    assert message["status"] == "ok"
    assert (message["width"], message["height"]) == (80, 120)
    with Image.open(preview) as image:
        assert image.size == (80, 120)
    for point in message["suggestedCorners"].values():
        assert len(point) == 2
        assert all(0 <= coordinate <= 1 for coordinate in point)


def test_detects_a_clear_receipt_outline(tmp_path):
    """Test that the worker can detect a clear receipt outline.

    Args:
        tmp_path (Path): A temporary directory provided by pytest.
    """
    original = tmp_path / "original.png"
    preview = tmp_path / "preview.webp"
    image = Image.new("RGB", (400, 600), "gray")
    ImageDraw.Draw(image).rectangle((50, 70, 350, 530), fill="white")
    image.save(original)
    result = run_worker([
        {"requestId": "outline", "type": "preview", "originalPath": str(original), "previewPath": str(preview)}
    ])

    corners = json.loads(result.stdout.splitlines()[1])["suggestedCorners"]
    assert corners["topLeft"] == pytest.approx([0.125, 0.117], abs=0.03)
    assert corners["bottomRight"] == pytest.approx([0.875, 0.883], abs=0.03)


def test_invalid_message_returns_an_error_with_request_id():
    """Test that the worker returns an error with the correct request ID for an invalid message."""
    result = run_worker([{"requestId": "wrong", "type": "unknown"}, []])
    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert messages[1] == {
        "requestId": "wrong",
        "status": "error",
        "error": "Unsupported request type",
    }
    assert messages[2] == {
        "requestId": None,
        "status": "error",
        "error": "Request must be an object",
    }


def test_hpi_startup_failure_has_no_ready_message():
    """Test that the worker does not send a ready message if HPI startup fails."""
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join([
        str(WORKER_DIRECTORY / "test" / "fixtures"),
        str(WORKER_DIRECTORY.parent),
    ])
    environment["OCR_TEST_FAIL_START"] = "1"
    result = subprocess.run(
        [sys.executable, "-m", "python_worker.worker"],
        text=True,
        capture_output=True,
        cwd=WORKER_DIRECTORY.parent,
        env=environment,
        check=False,
    )

    assert result.returncode != 0
    assert result.stdout == ""
    assert "Traceback" in result.stderr
    assert "HPI dependencies unavailable" in result.stderr


def test_process_request_creates_final_images_and_returns_ocr(tmp_path):
    """Test that the worker correctly processes a request, creates final images, and returns OCR results.

    Args:
        tmp_path (pathlib.Path): Temporary directory provided by pytest for creating test files.
    """
    original = tmp_path / "original.png"
    archive = tmp_path / "archive.webp"
    ocr_image = tmp_path / "ocr.webp"
    Image.new("RGB", (100, 200), "white").save(original)
    corners = {
        "topLeft": [0, 0],
        "topRight": [1, 0],
        "bottomRight": [1, 1],
        "bottomLeft": [0, 1],
    }
    result = run_worker([{
        "requestId": "process-1",
        "type": "process",
        "originalPath": str(original),
        "archivePath": str(archive),
        "ocrPath": str(ocr_image),
        "corners": corners,
    }])

    ready, response = [json.loads(line) for line in result.stdout.splitlines()]
    assert ready == {"type": "ready"}
    assert response["requestId"] == "process-1"
    assert response["status"] == "ok"
    assert response["plainText"] == "RECEIPT"
    assert response["lines"] == [{
        "text": "RECEIPT",
        "confidence": 0.95,
        "box": [0.0, 0.0, 1.0, 1.0],
        "index": 0,
    }]
    assert (response["width"], response["height"]) == (100, 200)
    with Image.open(archive) as image:
        assert image.mode == "RGB"
    with Image.open(ocr_image) as image:
        assert len(set(image.getpixel((20, 20)))) == 1
    assert "PaddleOCR predicted" in result.stderr
    assert "Native OCR prediction log" in result.stderr
    assert result.stderr.count("PaddleOCR initialized") == 1


def test_invalid_process_corners_return_error_without_images(tmp_path):
    """Test that the worker returns an error when the process request has invalid corners and does not create images.

    Args:
        tmp_path (pathlib.Path): Temporary directory provided by pytest for creating test files.
    """
    original = tmp_path / "original.png"
    archive = tmp_path / "archive.webp"
    ocr_image = tmp_path / "ocr.webp"
    Image.new("RGB", (100, 200), "white").save(original)
    result = run_worker([{
        "requestId": "invalid",
        "type": "process",
        "originalPath": str(original),
        "archivePath": str(archive),
        "ocrPath": str(ocr_image),
        "corners": {"topLeft": [0, 0]},
    }])

    response = json.loads(result.stdout.splitlines()[1])
    assert response["requestId"] == "invalid"
    assert response["status"] == "error"
    assert not archive.exists()
    assert not ocr_image.exists()


def test_ocr_failure_returns_error_and_worker_keeps_running(tmp_path):
    """Test that the worker returns an error when the OCR prediction fails and continues to process subsequent requests.

    Args:
        tmp_path (pathlib.Path): Temporary directory provided by pytest for creating test files.
    """
    original = tmp_path / "original.png"
    archive = tmp_path / "archive.webp"
    ocr_image = tmp_path / "ocr.webp"
    preview = tmp_path / "preview.webp"
    Image.new("RGB", (100, 200), "white").save(original)
    result = run_worker([
        {
            "requestId": "process-failure",
            "type": "process",
            "originalPath": str(original),
            "archivePath": str(archive),
            "ocrPath": str(ocr_image),
            "corners": {
                "topLeft": [0, 0],
                "topRight": [1, 0],
                "bottomRight": [1, 1],
                "bottomLeft": [0, 1],
            },
        },
        {
            "requestId": "preview-after-failure",
            "type": "preview",
            "originalPath": str(original),
            "previewPath": str(preview),
        },
    ], {"OCR_TEST_FAIL_PREDICT": "1"})

    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert messages[1]["status"] == "error"
    assert "OCR prediction failed" in messages[1]["error"]
    assert messages[2]["status"] == "ok"
    assert preview.exists()
