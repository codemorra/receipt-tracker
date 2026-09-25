import "./App.css";

import { useTranslation } from "react-i18next";

function App() {
  const { t, i18n } = useTranslation();

  function switchLanguage(language: "de" | "en") {
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <nav aria-label={t("languageLabel")} className="mb-8 flex gap-3">
        <button
          type="button"
          aria-pressed={i18n.language === "de"}
          className="rounded border px-3 py-2"
          onClick={() => switchLanguage("de")}
        >
          {t("german")}
        </button>
        <button
          type="button"
          aria-pressed={i18n.language === "en"}
          className="rounded border px-3 py-2"
          onClick={() => switchLanguage("en")}
        >
          {t("english")}
        </button>
      </nav>

      <h1 className="text-3xl font-bold">{t("heading")}</h1>
      <p className="mt-4">{t("intro")}</p>
    </main>
  );
}

export default App;
