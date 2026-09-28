# Python Worker

Use Python 3.12. Create the local environment and install dependencies with:

    python3.12 -m venv python_worker/.venv
    source python_worker/.venv/bin/activate
    python -m pip install -r python_worker/requirements.txt
    paddleocr install_hpi_deps cpu

Start the worker from the repository root with `python_worker/.venv/bin/python -m python_worker.worker`.
It stays alive and reads one JSON request per line from stdin. Stdout contains only JSONL protocol messages; diagnostics go to stderr.

The first stdout message is {"type":"ready"} after PaddleOCR initializes successfully. If HPI initialization fails, the worker exits with an error on stderr and does not send ready. A preview request looks like:

    {"requestId":"example-1","type":"preview","originalPath":"/path/to/original.jpg","previewPath":"/path/to/preview.webp"}

The response includes the same requestId, status, preview dimensions, and suggestedCorners. Corners are named topLeft, topRight, bottomRight, and bottomLeft; each is an [x, y] pair normalized to 0–1. Coordinates refer to the orientation-corrected preview and can be applied to the original after the same EXIF orientation correction. Errors return status "error" and an error message. Invalid requests do not stop the worker.

A final processing request uses the original image and confirmed normalized corners:

    {"requestId":"example-2","type":"process","originalPath":"/path/to/original.jpg","archivePath":"/path/to/archive.webp","ocrPath":"/path/to/ocr.webp","corners":{"topLeft":[0,0],"topRight":[1,0],"bottomRight":[1,1],"bottomLeft":[0,1]}}

Its response contains `width`, `height`, `plainText`, and ordered `lines` with `index`, `text`, `confidence`, and normalized `box` coordinates. The backend exposes this through `POST /api/scans/:scanId/process` with a JSON body containing `corners`; the response includes an `archiveUrl` for the processed image.

The worker uses Pillow for EXIF correction, gentle brightness and contrast adjustment, and WebP output. OpenCV provides optional corner suggestions.
If OpenCV is unavailable or no convincing contour is found, the worker suggests an inset frame that the user can adjust.

Run the worker tests with:

    python_worker/.venv/bin/python -m pytest python_worker/test

The worker tests use a local PaddleOCR substitute and do not download OCR models.

PaddleOCR is initialized once per worker process with PP-OCRv6 medium detection and recognition, German language, CPU HPI, and MKL-DNN. The OCR result includes plain text and ordered lines with confidence and normalized bounding boxes.
