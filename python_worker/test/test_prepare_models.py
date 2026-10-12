import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from python_worker import prepare_models


def stub_models(monkeypatch, failure=None, error=None):
    """Stub model boundaries so these tests cannot import or download Paddle models."""
    calls = []
    images = []

    def step(name):
        """Record the step and optionally simulate a failure."""
        calls.append(name)
        if failure == name:
            raise error if error is not None else RuntimeError(f"{name} unavailable")

    def recognize(crops):
        """Record the recognition step and validate the input crops."""
        step("recognition")
        assert len(crops) == 1 and crops[0].ndim == 3
        yield {"rec_text": "SETUP", "rec_score": 0.95}

    ocr = SimpleNamespace(paddlex_pipeline=SimpleNamespace(text_rec_model=recognize))

    def initialize_ocr():
        """Initialize the OCR model and record the initialization step."""
        step("OCR initialization")
        return ocr

    def recognize_image(model, path):
        """Simulate recognizing text in an image and record the inference step."""
        assert model is ocr
        images.append(path)
        with Image.open(path) as image:
            assert image.mode == "RGB"
        step("OCR inference")
        # No detected text: explicit recognition must still be warmed up.
        return {"plainText": "", "lines": [], "rows": []}

    def orientation_predict(pixels):
        """Simulate predicting the orientation of an image and record the inference step."""
        step("orientation inference")
        return [SimpleNamespace(json={"res": {"label_names": ["0"], "scores": [0.95]}})]

    def initialize_orientation():
        """Initialize the orientation model and record the initialization step."""
        step("orientation initialization")
        return SimpleNamespace(predict=orientation_predict)

    monkeypatch.setattr(prepare_models, "initialize_ocr", initialize_ocr)
    monkeypatch.setattr(prepare_models, "recognize_image", recognize_image)
    monkeypatch.setattr(prepare_models, "create_orientation_model", initialize_orientation)
    return calls, images


def test_prepare_exercises_all_models_even_when_detection_returns_no_text(monkeypatch, capsys):
    """Test that all models are prepared even when the OCR detection returns no text."""
    calls, images = stub_models(monkeypatch)
    assert prepare_models.main() == 0
    assert calls == [
        "OCR initialization", "OCR inference", "recognition",
        "orientation initialization", "orientation inference",
    ]
    assert all(not path.parent.exists() for path in images)
    assert "OCR setup complete." in capsys.readouterr().out


@pytest.mark.parametrize("failure,phase", [
    ("OCR initialization", "OCR initialization"),
    ("OCR inference", "OCR warmup"),
    ("recognition", "OCR warmup"),
    ("orientation initialization", "orientation initialization"),
    ("orientation inference", "orientation warmup"),
])
def test_setup_failure_is_contextual_and_cleans_up(monkeypatch, capsys, failure, phase):
    """Test that a setup failure is reported in the correct context and that resources are cleaned up."""
    _, images = stub_models(monkeypatch, failure)
    assert prepare_models.main() == 1
    output = capsys.readouterr()
    assert f"failed during {phase}" in output.err
    assert f"{failure} unavailable" in output.err
    assert "OCR setup complete." not in output.out
    assert all(not path.parent.exists() for path in images)


@pytest.mark.parametrize("error", [
    ImportError("HPI missing"), PermissionError("cache is read-only"),
    Exception("No available model hosting platforms detected"),
])
def test_known_setup_errors_preserve_the_reason(monkeypatch, capsys, error):
    """Test that known setup errors preserve the original error message."""
    stub_models(monkeypatch, "OCR initialization", error)
    assert prepare_models.main() == 1
    assert str(error) in capsys.readouterr().err


def test_unexpected_developer_error_is_not_swallowed(monkeypatch):
    """Test that unexpected developer errors are not swallowed and resources are cleaned up."""
    _, images = stub_models(monkeypatch, "orientation inference", TypeError("model bug"))
    with pytest.raises(TypeError, match="model bug"):
        prepare_models.main()
    assert all(not path.parent.exists() for path in images)


@pytest.mark.parametrize("extra_env,expected_status", [
    ({}, 0),
    ({"ORIENTATION_TEST_FAIL_START": "1"}, 1),
    ({"OCR_TEST_FAIL_RECOGNIZE": "1"}, 1),
])
def test_prepare_cli_uses_production_factories_with_paddle_substitute(extra_env, expected_status):
    """Test that the CLI uses the production factories with the Paddle substitute and respects environment-induced failures."""
    root = Path(__file__).resolve().parents[2]
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join([
        str(root / "python_worker/test/fixtures"), str(root),
    ])
    environment.update(extra_env)
    result = subprocess.run(
        [sys.executable, "-m", "python_worker.prepare_models"],
        cwd=root, env=environment, text=True, capture_output=True, timeout=20, check=False,
    )
    assert result.returncode == expected_status
    assert ("OCR setup complete." in result.stdout) == (expected_status == 0)
    if expected_status == 0:
        assert "Recognition predicted" in result.stderr
        assert "Orientation predicted" in result.stderr
    else:
        assert "OCR preparation failed during" in result.stderr
