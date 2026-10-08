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

### Receipt Archive

- Saved receipt table with merchant, purchase date/time, total, and warranty count
- One search field for merchant and product names, including learned aliases
- Pagination with 20 receipts per page and newest receipts first
- Read-only receipt details in a full-height side panel with the archive image
- Shared compact summaries for import drafts and saved receipts, with expandable product details

### Warranties

- Read-only overview with one row per saved warranty or statutory warranty period
- Product name and alias search, status and warranty type filters
- Status based on saved calendar dates, including a fixed 30-day expiry window
- Pagination with 20 entries per page and direct access to the existing receipt detail panel

### Analytics

- Spending totals, receipt counts, average receipt values, and merchant breakdowns
- Spending timeline with daily, weekly, or monthly totals
- Product price history with name and alias search, price statistics, and purchase history
- Shared period presets, custom date ranges, and searchable merchant filters
- Shareable filter URLs with reload and browser Back/Forward support
- Receipt details accessible directly from purchase history

## Technical Overview

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- react-i18next
- Chart.js with react-chartjs-2

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
- OpenAI Responses API
- Shared receipt extraction prompt and structured JSON output

The currently tested model configurations are:

- Ollama / `qwen3.8:27b`
- OpenAI / `gpt-6-luna`

### Storage

- SQLite
- Filesystem

## Getting Started

Requires Node.js 22.12 or newer, npm, and Python 3.12.

The setup below assumes Linux. See [Known Limitations and Planned Improvements](#known-limitations-and-planned-improvements) for platform support.

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

Provider settings are stored in SQLite. Previous `LLM_PROVIDER`, `OLLAMA_*`, and `OPENAI_*` environment variables are ignored and are not migrated automatically. Configure existing installations through Settings after starting the application.

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
- OpenAI: model and API key; the official OpenAI Responses endpoint is fixed in the backend.

Providers start unconfigured and disabled, with no default. You can configure multiple providers, enable or disable them, and set a default. Only enabled, fully configured providers are selectable during import. Each processing request uses the selected provider; there is no automatic fallback. The API also accepts an omitted `provider` field and then uses the saved default.

### Local API-key storage

Cloud API keys are encrypted in SQLite using AES-256-GCM. When the first key is saved, the backend creates a random master key in `$XDG_CONFIG_HOME/receipt-tracker/keys/master.key`, or `~/.config/receipt-tracker/keys/master.key` when `XDG_CONFIG_HOME` is unset. Set `SECRETS_KEY_DIR` to an absolute path outside the repository to change this location. On Unix-like systems, storage requires owner-only access; new directories and key files use `0700` and `0600` permissions.

Saved API keys are never returned to the frontend or written to logs. Settings lets you replace or remove them. Keep the master key separate from the database and back up both. If the key is missing or does not match, restore the original key; otherwise remove all stored API keys in Settings before entering new ones. See [Known Limitations and Planned Improvements](#known-limitations-and-planned-improvements) for the local-use security boundaries.

## LLM Providers and Runtime Example

Receipt extraction currently uses the same core receipt prompt and schema across the supported providers, with small model-specific settings where needed.

The following measurements are single example runs using the same receipt with 17 positions, 18 discounts, a deposit charge, and a deposit return.

| Model         | Provider | LLM / API |
| ------------- | -------- | --------: |
| `qwen3.8:27b` | Ollama   |  139.95 s |
| `gpt-6-luna`  | OpenAI   |   16.17 s |

Both models extracted all 17 positions and 18 discounts with correct amounts and discount assignments.

The Qwen run was executed locally on an AMD Radeon RX 7900 XTX. Cloud timings depend on provider and network load. These values are example measurements from one receipt and one run per model, not general model benchmarks.

The two configurations are currently used as practical reference points for receipt extraction.

## Import Workflow

The following activity diagram shows the receipt import process, from image upload and preprocessing to OCR, LLM-based data extraction, database matching, user validation, and persistent storage.

![Import Workflow](docs/import-workflow.svg)

Upload an image, adjust its frame or rotation, select a provider, and process the receipt. Review the compact summary or open **Edit data** to correct the draft alongside its image. Closing the editor preserves your inputs; saving requires valid data.

**Review duplicate** compares possible matches. **Import anyway** confirms the comparison and enables **Save receipt** without saving immediately. The backend checks the final values again. Saved receipts also load through direct links such as `/import?receiptId=123`.

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

## Browsing Saved Receipts

**Receipts** lists saved receipts, newest first, with 20 entries per page. One search field matches merchant and product names and their learned aliases. Selecting a row opens a read-only panel with the archive image, receipt details, and expandable product metadata.

## Using Analytics

Open **Analytics** and choose **Spending** or **Price History**. Both tabs offer **Last 30 days**, **Last 3 months**, **This year**, **All time**, and **Custom range**, with inclusive dates and an optional merchant filter. Preset links calculate their date boundaries from the current local date when opened; only custom ranges store fixed dates in the URL.

**Spending** sums the saved final receipt totals, including receipt-wide discounts already reflected in those totals. The timeline groups ranges of up to 45 days by day, up to 183 days by week, and longer ranges by month. Weeks start on Monday, and empty periods have zero totals. Average receipt value is unavailable when no receipts match.

**Price History** requires selecting a saved product; the search matches canonical names and learned aliases. Statistics and the chart use unit prices as recorded on receipts. Purchases with missing unit prices remain in the table but are excluded from statistics and the chart. Select a receipt in the table to open its existing detail panel.

Analytics does not convert currencies. Spending rejects selections containing multiple receipt currencies; Price History rejects selections whose available unit prices use multiple currencies. Narrow the date range or merchant filter to view a single currency. Prices are not normalized to package sizes or units such as €/kg or €/l, and category analysis is not included.

## Using Warranties

Open **Warranties** to see the product, warranty type, merchant, purchase date, saved start and end dates, and status. Each saved period has its own row, so a receipt item with multiple periods appears more than once. Search by canonical product name or learned alias, and filter by status or type: **Statutory warranty**, **Manufacturer warranty**, or **Extended warranty**. Changing the search or a filter returns to page 1.

The table shows up to 20 entries per page. Periods that have begun and have not expired appear first, ordered by nearest end date, followed by future periods ordered by start date, then expired periods with the most recent end date first. Select a row to open its saved receipt in the existing detail panel, including warranty notes.

Statuses use the backend server's current local calendar day and only the saved dates:

| Status            | Rule                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| **Not started**   | Start date is after today.                                             |
| **Active**        | Period has begun and ends more than 30 days from today.                |
| **Expiring soon** | Period has begun and ends today or within the next 30 days, inclusive. |
| **Expired**       | End date is before today.                                              |

A period begins on its start date and remains unexpired on its end date. Warranty dates are calendar days without times. The overview does not generate periods or infer statutory durations. Editing or deleting saved warranties and expiry notifications are not available.

## Database Model

The database separates receipts, receipt items, products, merchants, aliases, categories, discounts, and warranty information.

Aliases allow the application to learn confirmed receipt labels over time and automatically recognize previously encountered products and merchants.

![Entity Relationship Diagram](docs/erd.svg)

## Project Status

Receipt import, review, duplicate checking, saving, archive search, spending analytics, product price history, and the warranty overview are implemented, together with AI provider settings, German/English language support, and appearance controls. The project is under active development.

## Known Limitations and Planned Improvements

### Current Limitations

- **Extraction accuracy:** all tested models occasionally produce incorrect receipt data. User review remains necessary.
- **Platform support:** only Linux has been tested, including the OCR worker's high-performance inference dependencies. Native Windows and macOS support is unverified; Windows users can try WSL2.
- **Saved receipts:** archive details are read-only; editing and deleting stored receipts are not available.
- **Local use and security:** there is no user authentication. API-key encryption protects a database copy without its master key, but not access to both files or the running application.
- **Custom backend ports:** changing `PORT` also requires updating the frontend API proxy manually.

### Planned Improvements

- Integrate import editing directly into the expanded product details, replacing the separate **Edit data** panel.
- Improve extraction accuracy, with future model tuning expected to focus primarily on Luna.
- Add receipt filters and product/merchant browsing.
- Add product price comparisons.
- Add category-based analysis.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
