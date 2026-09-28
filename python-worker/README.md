# Python Worker

Use Python 3.12. Create the local environment and install dependencies with:

    python3.12 -m venv python-worker/.venv
    python-worker/.venv/bin/python -m pip install -r python-worker/requirements.txt

Start the worker with `python-worker/.venv/bin/python python-worker/worker.py`.
It stays alive and reads one JSON request per line from stdin. Stdout contains only JSONL protocol messages; diagnostics go to stderr.

The first stdout message is {"type":"ready"}. A preview request looks like:

    {"requestId":"example-1","type":"preview","originalPath":"/path/to/original.jpg","previewPath":"/path/to/preview.webp"}

The response includes the same requestId, status, preview dimensions, and suggestedCorners. Corners are named topLeft, topRight, bottomRight, and bottomLeft; each is an [x, y] pair normalized to 0–1. Coordinates refer to the orientation-corrected preview and can be applied to the original after the same EXIF orientation correction. Errors return status "error" and an error message. Invalid requests do not stop the worker.

The worker uses Pillow for EXIF correction, gentle brightness and contrast adjustment, and WebP output. OpenCV provides optional corner suggestions.
If OpenCV is unavailable or no convincing contour is found, the worker suggests an inset frame that the user can adjust.

Run the worker tests with:

    python-worker/.venv/bin/python -m pytest python-worker/test
