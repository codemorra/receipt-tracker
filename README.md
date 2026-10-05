# Receipt Tracker

> This project is my final project for a software development bootcamp and is currently under active development.

Receipt Tracker is an application for digitizing, organizing, and analyzing receipts.

Users can import a receipt image, adjust the detected receipt area, extract its contents using OCR, and review structured data generated with the help of an LLM. Products and merchants are matched against a database so that previously confirmed receipt labels can be recognized automatically in future imports.

The application keeps the user involved in the import process by allowing uncertain matches and newly detected products to be reviewed before they are stored.

## Features

### Receipt Processing

- JPEG, PNG, and WebP receipt image upload with automatic preview and orientation
- Automatic receipt detection with manual corner adjustment
- Perspective correction and image preprocessing
- OCR-based receipt extraction
- LLM-assisted structuring and normalization
- Configurable AI providers with a saved default and per-receipt selection
- Merchant and product matching
- Manual review and correction of receipt data, items, discounts, and matches
- Detection and comparison of possible duplicate receipts
- Learning recurring merchant and product labels through aliases
- Manual warranty information for individual receipt items
- Persistent storage of processed receipts and receipt images
- German and English user interface with light/dark themes and accent colors

### Planned Receipt Management & Analysis

- Receipt overview and navigation to saved receipts
- General search and filtering
- Product and merchant browsing
- Product price history
- Price comparisons
- Expense statistics
- Category-based analysis
- Merchant-based analysis
- Dedicated warranty overview

## Technical Overview

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- react-i18next

### Backend

- Node.js
- Express
- TypeScript
- Zod
- Drizzle ORM

### Image Processing & OCR

- Python 3.12
- OpenCV
- Pillow
- PaddleOCR

### AI

- Local LLM integration via Ollama
- Mistral API
- OpenAI Responses API
- Shared receipt extraction prompt and structured JSON output

The currently tested model configurations are:

- Ollama / `qwen3.8:27b`
- Mistral / `mistral-medium-latest`
- OpenAI / `gpt-6-luna`

### Storage

- SQLite
- Filesystem

## Getting Started

Requires Node.js 22.12 or newer, npm, and Python 3.12.

Currently tested on Linux only. The setup below assumes Linux, including the OCR worker's high-performance inference dependencies. Native Windows and macOS support has not been verified; Windows users can try the Linux setup through WSL2.

### Clone the repository

```bash
git clone https://github.com/codemorra/receipt-tracker.git
cd receipt-tracker
```

### Install Node.js dependencies

```bash
npm ci
npm --prefix frontend ci
npm --prefix backend ci
```

### Set up the Python worker

```bash
python3.12 -m venv python_worker/.venv
source python_worker/.venv/bin/activate
python -m pip install -r python_worker/requirements.txt
paddleocr install_hpi_deps cpu
```

The backend starts and manages the Python worker automatically during normal development.

For more details, see [python_worker/README.md](python_worker/README.md).

### Configure the environment (optional)

The backend runs with default values without a `.env` file. To override infrastructure settings, create the optional backend environment file:

```bash
cp backend/.env.example backend/.env
```

`backend/.env` configures infrastructure only. See [backend/.env.example](backend/.env.example) for the available options:

| Variable            | Default / purpose                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `PORT`              | Backend port, `3000`                                                                        |
| `DATABASE_FILE`     | SQLite file, `./receipt-tracker.sqlite` relative to the backend process's working directory |
| `PYTHON_EXECUTABLE` | Python executable, `python_worker/.venv/bin/python` in the repository                       |
| `SCANS_DIR`         | Temporary scan directory, `data/scans` in the repository                                    |
| `LOG_FILE`          | Backend log, `data/logs/backend.log` in the repository                                      |
| `SECRETS_KEY_DIR`   | Absolute directory for the local master key, outside the repository                         |

Provider settings are stored in SQLite. Previous `LLM_PROVIDER`, `OLLAMA_*`, `MISTRAL_*`, and `OPENAI_*` environment variables are ignored and are not migrated automatically. Configure existing installations through Settings after starting the application.

### Start the backend

```bash
npm run dev:backend
```

The backend applies database migrations and starts the Python worker automatically.

### Start the frontend

In another terminal:

```bash
npm run dev:frontend
```

Vite normally serves the frontend on `http://localhost:5173` and proxies `/api` to the backend on port `3000`.
If you change `PORT`, update the API proxy in `frontend/vite.config.ts` accordingly.

### Configure AI providers

Open **Settings** in the frontend and choose **Add provider**. The model field is prefilled with the recommended model for that provider:

- Ollama: model and base URL, initially `http://127.0.0.1:11434`. Start Ollama and pull the model before processing, for example `ollama pull qwen3.8:27b`.
- Mistral: model and API key; the official Mistral endpoint is fixed in the backend.
- OpenAI: model and API key; the official OpenAI Responses endpoint is fixed in the backend.

Providers start unconfigured and disabled, with no default. You can configure multiple providers, enable or disable them, and set a default. Only enabled, fully configured providers are selectable during import. Each processing request uses the selected provider; there is no automatic fallback. The API also accepts an omitted `provider` field and then uses the saved default.

### Local API-key storage

Cloud API keys are encrypted in SQLite using AES-256-GCM. When the first key is saved, the backend creates a random master key in `$XDG_CONFIG_HOME/receipt-tracker/keys/master.key`, or `~/.config/receipt-tracker/keys/master.key` when `XDG_CONFIG_HOME` is unset. Set `SECRETS_KEY_DIR` to an absolute path outside the repository to change this location. On Unix-like systems, storage requires owner-only access; new directories and key files use `0700` and `0600` permissions.

Saved API keys are never returned to the frontend or written to logs. Settings lets you replace or remove them. Keep the master key separate from the database and back up both. If the key is missing or does not match, restore the original key; otherwise remove all stored API keys in Settings before entering new ones. Encryption protects a database copy without its master key; it does not protect against access to both files or the running backend. The application is intended for local use and has no user authentication.

## LLM Providers and Runtime Example

Receipt extraction currently uses the same core receipt prompt and schema across the supported providers, with small model-specific settings where needed.

The following measurements are single example runs using the same receipt with 17 positions, 18 discounts, a deposit charge, and a deposit return.

| Model                   | Provider | LLM / API |    Total |
| ----------------------- | -------- | --------: | -------: |
| `qwen3.8:27b`           | Ollama   |   95.52 s |  97.34 s |
| `mistral-medium-latest` | Mistral  |  102.02 s | 103.77 s |
| `gpt-6-luna`            | OpenAI   |   13.20 s |  14.94 s |

All three models produced correct core extraction results for this example receipt.

The Qwen run was executed locally on an AMD Radeon RX 7900 XTX. Cloud timings depend on provider and network load. These values are example measurements from one receipt and one run per model, not general model benchmarks.

The three configurations are currently used as practical reference points for receipt extraction. All tested models still show occasional extraction issues on some receipts, so further optimization is needed. Future tuning is expected to focus primarily on Luna, while user review remains important regardless of the selected provider.

## Import Workflow

The following activity diagram shows the receipt import process, from image upload and preprocessing to OCR, LLM-based data extraction, database matching, user validation, and persistent storage.

![Import Workflow](docs/import-workflow.svg)

The desktop workspace shows the scan on the left and editable receipt data on the right; smaller screens stack the sections. Uploading an image immediately creates the corrected preview. Adjust the frame or rotation, select a provider, and process the receipt. The resulting archive image remains visible while reviewing matches, items, discounts, and warranty periods.

Possible duplicates are compared with saved receipts and their images. You can cancel the import or explicitly save anyway; the backend checks for duplicates again using the final reviewed values. After saving, the application shows the stored receipt, including its associations, discounts, warranties, and archive image. Direct links such as `/import?receiptId=123` also load it after a refresh.

The processing flow is:

```text
Image Upload
    ↓
Automatic Preview & Orientation
    ↓
Frame & Provider Selection
    ↓
Image Processing
    ↓
OCR
    ↓
LLM Extraction
    ↓
Database Matching
    ↓
Duplicate Detection
    ↓
User Review
    ↓
Final Duplicate Check
    ↓
Persistent Storage
```

## Database Model

The database separates receipts, receipt items, products, merchants, aliases, categories, discounts, and warranty information.

Aliases allow the application to learn confirmed receipt labels over time and automatically recognize previously encountered products and merchants.

![Entity Relationship Diagram](docs/erd.svg)

## Project Status

The core receipt import, review, duplicate-check, and save workflow is implemented, including direct loading of a saved receipt by its ID.

The responsive frontend includes the complete import workflow, AI provider settings, and language and appearance controls. Saved receipts can be displayed after import or through a direct ID link; the receipt management section, analysis, and the warranty overview remain placeholder pages.

The next development phase focuses on receipt management and analysis features, including:

- Receipt overview and search/filtering
- Product and merchant browsing
- Product price history and comparisons
- Expense statistics
- Category- and merchant-based analysis
- Warranty overview

The project is still under active development and is not production-ready.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
