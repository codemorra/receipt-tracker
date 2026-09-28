import { useState, type SubmitEvent } from "react";
import { useTranslation } from "react-i18next";
import ReceiptImagePreview, { type Corners } from "./scans/ReceiptImagePreview";
import "./App.css";

// Types and constants for handling scan responses and file uploads.
interface ScanResponse {
  scanId: string;
  previewUrl: string;
  width: number;
  height: number;
  suggestedCorners: Corners;
}

// Maximum allowed upload size and supported file types.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const supportedTypes = ["image/jpeg", "image/png", "image/webp"];
// Error keys mapping for different upload and scan errors.
const errorKeys: Record<string, string> = {
  invalid_upload: "errors.invalidUpload",
  upload_too_large: "errors.tooLarge",
  worker_unavailable: "errors.workerUnavailable",
  invalid_image: "errors.invalidImage",
  scan_failed: "errors.uploadFailed",
  request_failed: "errors.uploadFailed",
};

// Main App component handling file uploads, scan responses, and UI rendering.
function App() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errorKey, setErrorKey] = useState("");
  const [previewError, setPreviewError] = useState(false);

  // Function to switch the application language between German and English.
  function switchLanguage(language: "de" | "en") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }

  // Function to handle the file upload form submission.
  async function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading) return;
    setErrorKey("");
    if (!supportedTypes.includes(file.type)) {
      setErrorKey("errors.unsupportedType");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrorKey("errors.tooLarge");
      return;
    }

    setUploading(true);
    setScan(null);
    setCorners(null);
    setPreviewError(false);
    try {
      // Send the file to the server for scanning.
      const response = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) {
        // Handle server error response.
        const code = typeof result.error === "string" ? result.error : "";
        setErrorKey(errorKeys[code] ?? "errors.uploadFailed");
        return;
      }
      const createdScan = result as ScanResponse;
      setScan(createdScan);
      setCorners(createdScan.suggestedCorners);
      setPreviewError(false);
    } catch {
      // Handle network or unexpected errors during the upload process.
      setErrorKey("errors.network");
    } finally {
      // Reset the uploading state regardless of success or failure.
      setUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 text-slate-900 sm:px-8">
      <nav
        aria-label={t("languageLabel")}
        className="mb-10 flex justify-end gap-2"
      >
        <button
          type="button"
          aria-pressed={i18n.language === "de"}
          className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-100 aria-pressed:bg-slate-900 aria-pressed:text-white"
          onClick={() => switchLanguage("de")}
        >
          {t("german")}
        </button>
        <button
          type="button"
          aria-pressed={i18n.language === "en"}
          className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-100 aria-pressed:bg-slate-900 aria-pressed:text-white"
          onClick={() => switchLanguage("en")}
        >
          {t("english")}
        </button>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="mt-2 text-slate-600">{t("intro")}</p>
      </header>

      <section
        aria-labelledby="upload-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 id="upload-heading" className="text-xl font-semibold">
          {t("uploadHeading")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("uploadHint")}</p>
        <form
          onSubmit={upload}
          className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="receipt-file"
              className="mb-2 block text-sm font-medium"
            >
              {t("fileLabel")}
            </label>
            <input
              id="receipt-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setScan(null);
                setCorners(null);
                setPreviewError(false);
                setErrorKey("");
              }}
              className="block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2"
            />
          </div>
          <button
            type="submit"
            disabled={!file || uploading}
            className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? t("uploading") : t("createPreview")}
          </button>
        </form>
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-sm text-slate-600"
        >
          {uploading ? t("uploading") : ""}
        </p>
        {errorKey && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {t(errorKey)}
          </p>
        )}
      </section>

      {scan && corners && (
        <section
          aria-labelledby="preview-heading"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 id="preview-heading" className="text-xl font-semibold">
            {t("previewHeading")}
          </h2>
          <p
            id="corner-instructions"
            className="mt-2 mb-5 text-sm text-slate-600"
          >
            {t("previewInstructions")}
          </p>
          {previewError && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {t("errors.previewUnavailable")}
            </p>
          )}
          <ReceiptImagePreview
            previewUrl={scan.previewUrl}
            width={scan.width}
            height={scan.height}
            corners={corners}
            onChange={setCorners}
            onImageError={() => setPreviewError(true)}
          />
        </section>
      )}
    </main>
  );
}

export default App;
