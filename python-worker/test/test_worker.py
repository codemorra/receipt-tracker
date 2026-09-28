import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

WORKER_DIRECTORY = Path(__file__).resolve().parents[1]


def run_worker(requests):
    """Run the worker with the given requests and return the result.

    Args:
        requests (list): A list of request dictionaries to send to the worker.

    Returns:
        subprocess.CompletedProcess: The result of running the worker.
    """
    return subprocess.run(
        [sys.executable, str(WORKER_DIRECTORY / "worker.py")],
        input="".join(json.dumps(request) + "\n" for request in requests),
        text=True,
        capture_output=True,
        check=True,
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
