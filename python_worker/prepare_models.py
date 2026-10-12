"""Prepare the production OCR models and HPI artifacts before starting the app."""

import sys
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy
from PIL import Image, ImageDraw, ImageFont

from .ocr import initialize_ocr, recognize_image
from .orientation import create_orientation_model, orientation_prediction


class ModelPreparationError(RuntimeError):
    """An expected setup failure, with the failing preparation phase attached."""


def prepare_models():
    """Initialize and exercise all production models, reusing their local cache."""
    phase = "OCR initialization"
    print("Preparing receipt OCR models...", flush=True)
    try:
        ocr = initialize_ocr()
        print("Detection and recognition models initialized.", flush=True)

        phase = "OCR warmup"
        with TemporaryDirectory(prefix="receipt-ocr-prepare-") as directory:
            image_path = Path(directory) / "warmup.png"
            image = Image.new("RGB", (640, 320), "white")
            draw = ImageDraw.Draw(image)
            font = ImageFont.load_default(size=32)
            draw.text((24, 24), "RECEIPT OCR SETUP", fill="black", font=font)
            draw.text((24, 96), "Total EUR 12.34", fill="black", font=font)
            image.save(image_path)
            recognize_image(ocr, image_path)

            # Detection can return no boxes. Exercise recognition explicitly so
            # successful preparation always includes its first inference too.
            crop = numpy.asarray(image.crop((16, 16, 624, 72)))[:, :, ::-1].copy()
            with redirect_stdout(sys.stderr):
                predictions = list(ocr.paddlex_pipeline.text_rec_model([crop]))
            if len(predictions) != 1:
                raise ValueError("Recognition warmup returned an unexpected result count")
            print("OCR warmup complete.", flush=True)

            phase = "orientation initialization"
            orientation = create_orientation_model()
            phase = "orientation warmup"
            orientation_prediction(orientation, image)
            print("Orientation model initialized and warmed up.", flush=True)
    except Exception as error:
        # PaddleX's model downloader also raises bare Exception for unavailable
        # model sources. Limit that case to initialization; programmer errors
        # and unexpected inference failures keep their original traceback.
        known_error = isinstance(error, (ImportError, OSError, RuntimeError, ValueError))
        download_error = type(error) is Exception and phase.endswith("initialization")
        if not known_error and not download_error:
            raise
        raise ModelPreparationError(
            f"OCR preparation failed during {phase}: {type(error).__name__}: {error}"
        ) from error

    print("OCR setup complete.", flush=True)


def main():
    try:
        prepare_models()
    except ModelPreparationError as error:
        print(error, file=sys.stderr)
        print(
            "Check network access for missing models, cache write permissions, "
            "and HPI dependencies (paddleocr install_hpi_deps cpu). "
            "Run preparation and the backend with the same Python environment "
            "and PaddleX cache.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
