import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReceiptImport from "./scans/ReceiptImport";
import SavedReceiptDetail from "./receipts/SavedReceiptDetail";
import "./App.css";

// Utility function to extract the receipt ID from the URL query parameters.
function receiptIdFromUrl(): number | null {
  const value = new URLSearchParams(window.location.search).get("receiptId");
  const id = Number(value);
  return value !== null && Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Main App component handling language, navigation, and page rendering.
function App() {
  const { t, i18n } = useTranslation();
  const [savedReceiptId, setSavedReceiptId] = useState<number | null>(
    receiptIdFromUrl,
  );

  // Effect to update the saved receipt ID when the browser's history changes (e.g., back/forward navigation).
  useEffect(() => {
    const onPopState = () => setSavedReceiptId(receiptIdFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Function to open a saved receipt by its ID and update the URL accordingly.
  function openSavedReceipt(receiptId: number) {
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

  // Function to switch the application language between German and English.
  function switchLanguage(language: "de" | "en") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
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

      <ReceiptImport
        active={savedReceiptId === null}
        onSaved={openSavedReceipt}
      />
      {savedReceiptId !== null && (
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
