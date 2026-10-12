# Python Worker

Use Python 3.12. Create the local environment and install dependencies with:

    python3.12 -m venv python_worker/.venv
    source python_worker/.venv/bin/activate
    python -m pip install -r python_worker/requirements.txt
    paddleocr install_hpi_deps cpu
    python -m python_worker.prepare_models

Run preparation from the repository root. It uses the worker's production configuration to initialize `PP-OCRv6_medium_det`, `PP-OCRv6_medium_rec`, and `PP-LCNet_x1_0_doc_ori`, including CPU HPI and any required ONNX conversion. It also runs OCR, explicit text recognition, and orientation warmups. Missing models, HPI dependencies, unwritable caches, and inference failures cause a nonzero exit status with setup context.

The first run can take several minutes. You can safely rerun the command; existing models and conversion artifacts are reused without intentionally downloading them again. PaddleX caches models under `~/.paddlex/official_models` by default; generated ONNX files also live in the model directories, which must be writable. `PADDLE_PDX_CACHE_HOME` can select a different cache root. Use the same Python environment, user, and cache setting for preparation and the backend. Model artifacts do not belong in Git.

After preparation, normal startup and the first preview use the prepared local models. Native initialization and process-local or image-size-dependent caches can still take time; a warmup does not eliminate that work in future processes or guarantee that every library component avoids network access. The backend's finite readiness timeout defaults to 180000 ms and can be adjusted with `PYTHON_WORKER_START_TIMEOUT_MS` (see `backend/.env.example`). The backend does not run dependency installation or the prepare command itself.

Start the worker from the repository root with `python_worker/.venv/bin/python -m python_worker.worker`.
It stays alive and reads one JSON request per line from stdin. Stdout contains only JSONL protocol messages; diagnostics go to stderr.

The first stdout message is {"type":"ready"} after PaddleOCR initializes successfully. If HPI initialization fails, the worker exits with an error on stderr and does not send ready. A preview request looks like:

    {"requestId":"example-1","type":"preview","originalPath":"/path/to/original.jpg","previewPath":"/path/to/preview.webp"}

The response includes the same requestId, status, preview dimensions, suggestedCorners, and `rotation`. Corners are named topLeft, topRight, bottomRight, and bottomLeft; each is an [x, y] pair normalized to 0–1. `rotation` is a clockwise correction of 0, 90, 180, or 270 degrees applied after EXIF correction. Coordinates refer to this rotated preview. Errors return status "error" and an error message. Invalid requests do not stop the worker.

Before creating the preview, the worker classifies the detected receipt area with PaddleOCR's `PP-LCNet_x1_0_doc_ori` model. This is direction classification only, without text recognition. The model is prepared during setup and initialized lazily once per worker process. Skipping preparation can still trigger Paddle's automatic download on first use. Predictions at or above 0.8 confidence are applied directly. For an uncertain prediction, the worker also classifies two centered crops retaining 80% and 60% of each image dimension. It applies their direction only when both agree with at least 0.9 confidence. These crops are used only for classification; they do not change receipt corners or remove content from the output images. If the crops disagree or remain uncertain, the orientation stays unchanged. Unavailable models and prediction failures also leave the orientation unchanged; failures are reported on stderr. The user can turn the preview left or right while preserving adjusted corners.

A final processing request uses the original image and confirmed normalized corners:

    {"requestId":"example-2","type":"process","originalPath":"/path/to/original.jpg","archivePath":"/path/to/archive.webp","ocrPath":"/path/to/ocr.webp","rotation":90,"corners":{"topLeft":[0,0],"topRight":[1,0],"bottomRight":[1,1],"bottomLeft":[0,1]}}

Its response contains `width`, `height`, `plainText`, visual `rows`, and ordered `lines` with `index`, `text`, `confidence`, and normalized `box` coordinates. The backend exposes this through `POST /api/scans/:scanId/process` with a JSON body containing `corners` and the final selected `rotation`. If the API request omits `rotation`, the backend uses the scan's automatic correction, or 0 for older scan sessions. The worker applies the selected rotation to the EXIF-corrected original before cropping and creates both archive and OCR images from that same crop. It does not classify the orientation again during processing. The original file remains unchanged. The response includes an `archiveUrl` for the processed image.

The worker uses Pillow for EXIF correction, gentle brightness and contrast adjustment, and WebP output. OpenCV is a required dependency for receipt corner detection and perspective correction.
If no convincing contour is found, the worker selects the full image without an inset; the user can adjust the corners.

Run the worker tests with:

    python_worker/.venv/bin/python -m pytest python_worker/test

The worker tests use a local PaddleOCR substitute and do not download OCR models.

PaddleOCR is initialized once per worker process with PP-OCRv6 medium detection and recognition, German language, CPU HPI, and MKL-DNN. The OCR result includes plain text and ordered lines with confidence and normalized bounding boxes.
