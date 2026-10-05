import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import de from "./locales/de.json";

// Internationalization (i18n) setup for the application.
/**
 * Retrieves the saved language from local storage.
 * @returns The saved language ("de" or "en").
 */
const languageKey = "receipt-tracker.language";
function savedLanguage(): "de" | "en" {
  try {
    return window.localStorage.getItem(languageKey) === "de" ? "de" : "en";
  } catch {
    return "en";
  }
}

/**
 * Updates the application's language.
 * @param language The new language to set ("de" or "en").
 */
function updateLanguage(language: string) {
  const supported = language.startsWith("de") ? "de" : "en";
  document.documentElement.lang = supported;
  try {
    window.localStorage.setItem(languageKey, supported);
  } catch {
    // Language switching remains available when storage is disabled.
  }
}

i18n.on("languageChanged", updateLanguage);
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: savedLanguage(),
  supportedLngs: ["en", "de"],
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
