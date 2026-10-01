import { useEffect, useState, type SubmitEvent } from "react";
import { useTranslation } from "react-i18next";
import ReceiptImagePreview, { type Corners } from "./scans/ReceiptImagePreview";
import {
  addRotation,
  rotateCorners,
  type Rotation,
} from "./scans/scan-orientation";
import ReceiptReview from "./review/ReceiptReview";
import SavedReceiptDetail from "./receipts/SavedReceiptDetail";
import type { ReviewDto } from "./review/review-state";
import "./App.css";

// Types and constants for handling scan responses and file uploads.
interface ScanResponse {
  scanId: string;
  previewUrl: string;
  width: number;
  height: number;
  suggestedCorners: Corners;
  rotation: Rotation;
}

// Interface representing the response from processing a scan.
interface ProcessResponse {
  archiveUrl: string;
  plainText: string;
  review: ReviewDto;
  timings: {
    ocrDurationMs: number;
    llmDurationMs: number;
    totalDurationMs: number;
  };
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

// Utility function to extract the receipt ID from the URL query parameters.
function receiptIdFromUrl(): number | null {
  const value = new URLSearchParams(window.location.search).get("receiptId");
  const id = Number(value);
  return value !== null && Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Main App component handling file uploads, scan responses, and UI rendering.
function App() {
  const { t, i18n } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [corners, setCorners] = useState<Corners | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [uploading, setUploading] = useState(false);
  const [errorKey, setErrorKey] = useState("");
  const [previewError, setPreviewError] = useState(false);
  const [processed, setProcessed] = useState<ProcessResponse | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processErrorKey, setProcessErrorKey] = useState("");
  const [archiveError, setArchiveError] = useState(false);
  const [savedReceiptId, setSavedReceiptId] = useState<number | null>(
    receiptIdFromUrl,
  );

  // Effect to update the saved receipt ID when the browser's history changes (e.g., back/forward navigation).
  useEffect(() => {
    const onPopState = () => setSavedReceiptId(receiptIdFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Function to clear the current scan and reset related state variables.
  function clearScan() {
    setProcessed(null);
    setScan(null);
    setFile(null);
    setCorners(null);
    setRotation(0);
    setArchiveError(false);
    setProcessErrorKey("");
  }

  // Function to open a saved receipt by its ID and update the URL accordingly.
  function openSavedReceipt(receiptId: number) {
    clearScan();
    setSavedReceiptId(receiptId);
    const url = new URL(window.location.href);
    url.searchParams.set("receiptId", String(receiptId));
    window.history.pushState(null, "", url);
  }

  // Function to start a new import by clearing the saved receipt ID and updating the URL.
  function startNewImport() {
    setSavedReceiptId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("receiptId");
    window.history.pushState(null, "", url);
  }

  // Function to cancel the current scan session and handle related state updates.
  async function cancelScan() {
    if (!scan || uploading || processing) return;
    setProcessErrorKey("");
    try {
      const response = await fetch(`/api/scans/${scan.scanId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        setProcessErrorKey("errors.cancelFailed");
        return;
      }
      clearScan();
    } catch {
      setProcessErrorKey("errors.network");
    }
  }

  // Function to switch the application language between German and English.
  function switchLanguage(language: "de" | "en") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }

  // Function to handle the file upload form submission.
  async function upload(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading || processing || scan) return;
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
    setProcessed(null);
    setProcessErrorKey("");
    setArchiveError(false);
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
      setRotation(createdScan.rotation);
      setPreviewError(false);
    } catch {
      // Handle network or unexpected errors during the upload process.
      setErrorKey("errors.network");
    } finally {
      // Reset the uploading state regardless of success or failure.
      setUploading(false);
    }
  }

  // Function to handle the rotation of the receipt preview.
  function rotatePreview(turn: Rotation) {
    if (!corners || processing) return;
    setCorners(rotateCorners(corners, turn));
    setRotation(addRotation(rotation, turn));
    setProcessed(null);
    setProcessErrorKey("");
    setArchiveError(false);
  }

  // Function to handle the processing of a scan after it has been uploaded.
  async function processScan() {
    if (!scan || !corners || processing) return;
    setProcessing(true);
    setProcessErrorKey("");
    setProcessed(null);
    setArchiveError(false);
    try {
      // Send the corners to the server to process the scan.
      const response = await fetch(`/api/scans/${scan.scanId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corners, rotation }),
      });
      const result = await response.json();
      if (!response.ok) {
        // Handle server error response for the processing request.
        const code = typeof result.error === "string" ? result.error : "";
        const processErrorKeys: Record<string, string> = {
          invalid_corners: "errors.invalidCorners",
          invalid_rotation: "errors.invalidRotation",
          scan_not_found: "errors.scanNotFound",
          worker_unavailable: "errors.workerUnavailable",
          processing_failed: "errors.processingFailed",
          ollama_unavailable: "errors.ollamaUnavailable",
          ollama_failed: "errors.ollamaFailed",
          invalid_llm_response: "errors.invalidExtraction",
          invalid_extraction: "errors.invalidExtraction",
        };
        setProcessErrorKey(processErrorKeys[code] ?? "errors.processingFailed");
        return;
      }
      const scanResult = result as ProcessResponse;
      setProcessed({
        ...scanResult,
        archiveUrl: `${scanResult.archiveUrl}?v=${Date.now()}`,
      });
    } catch {
      // Handle network or unexpected errors during the processing request.
      setProcessErrorKey("errors.network");
    } finally {
      // Reset the processing state regardless of success or failure.
      setProcessing(false);
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

      {savedReceiptId === null ? (
        <>
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
                  key={scan?.scanId ?? "new"}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={uploading || processing || scan !== null}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setScan(null);
                    setCorners(null);
                    setPreviewError(false);
                    setProcessed(null);
                    setProcessErrorKey("");
                    setArchiveError(false);
                    setErrorKey("");
                  }}
                  className="block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2"
                />
              </div>
              <button
                type="submit"
                disabled={!file || uploading || processing || scan !== null}
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
                rotation={((rotation - scan.rotation + 360) % 360) as Rotation}
                corners={corners}
                onChange={(nextCorners) => {
                  setCorners(nextCorners);
                  setProcessed(null);
                  setProcessErrorKey("");
                  setArchiveError(false);
                }}
                onImageError={() => setPreviewError(true)}
                disabled={processing}
              />
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  disabled={processing || previewError}
                  onClick={() => rotatePreview(270)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50"
                >
                  {t("rotateLeft")}
                </button>
                <button
                  type="button"
                  disabled={processing || previewError}
                  onClick={() => rotatePreview(90)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-semibold disabled:opacity-50"
                >
                  {t("rotateRight")}
                </button>
                {!processed && (
                  <button
                    type="button"
                    disabled={processing || previewError}
                    onClick={() => void processScan()}
                    className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {processing ? t("processing") : t("processReceipt")}
                  </button>
                )}
                {!processed && (
                  <button
                    type="button"
                    disabled={processing}
                    onClick={() => void cancelScan()}
                    className="rounded-lg border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50"
                  >
                    {t("cancelImport")}
                  </button>
                )}
                <p role="status" aria-live="polite" className="text-slate-600">
                  {processing ? t("processing") : ""}
                </p>
              </div>
              {processErrorKey && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
                >
                  {t(processErrorKey)}
                </p>
              )}
            </section>
          )}

          {processed && (
            <section
              aria-labelledby="result-heading"
              className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <h2 id="result-heading" className="text-xl font-semibold">
                {t("resultHeading")}
              </h2>
              <p className="mt-3 text-sm text-slate-600">
                {t("processingDurations", {
                  ocr: new Intl.NumberFormat(i18n.language, {
                    maximumFractionDigits: 2,
                  }).format(processed.timings.ocrDurationMs / 1000),
                  llm: new Intl.NumberFormat(i18n.language, {
                    maximumFractionDigits: 2,
                  }).format(processed.timings.llmDurationMs / 1000),
                  total: new Intl.NumberFormat(i18n.language, {
                    maximumFractionDigits: 2,
                  }).format(processed.timings.totalDurationMs / 1000),
                })}
              </p>
              {archiveError && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
                >
                  {t("errors.archiveUnavailable")}
                </p>
              )}
              {!archiveError && (
                <img
                  src={processed.archiveUrl}
                  alt={t("archiveAlt")}
                  onError={() => setArchiveError(true)}
                  className="mt-5 mx-auto max-h-192 max-w-full rounded-lg border border-slate-200 object-contain"
                />
              )}
              <h3 className="mt-6 text-lg font-semibold">{t("ocrHeading")}</h3>
              {processed.plainText ? (
                <pre className="mt-3 whitespace-pre-wrap wrap-break-word rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-800">
                  {processed.plainText}
                </pre>
              ) : (
                <p className="mt-3 text-slate-600">{t("noOcrText")}</p>
              )}
            </section>
          )}

          {processed && (
            <ReceiptReview
              review={processed.review}
              onCancelled={clearScan}
              onSaved={openSavedReceipt}
            />
          )}
        </>
      ) : (
        <>
          <SavedReceiptDetail key={savedReceiptId} receiptId={savedReceiptId} />
          <button
            type="button"
            onClick={startNewImport}
            className="mt-6 rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white"
          >
            {t("newImport")}
          </button>
        </>
      )}
    </main>
  );
}

export default App;
