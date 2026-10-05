import { useTranslation } from "react-i18next";

/**
 * LanguageSwitch component for selecting the application's language.
 */
export default function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div
      className="flex gap-0.5 rounded-xl border border-shell bg-canvas/80 p-1 shadow-inner"
      role="group"
      aria-label={t("common.language.label")}
    >
      {(["de", "en"] as const).map((language) => (
        <button
          key={language}
          type="button"
          className="cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold tracking-wide text-muted hover:text-foreground aria-pressed:bg-(image:--surface-gradient) aria-pressed:text-accent aria-pressed:shadow-sm max-sm:px-2"
          aria-label={t(`common.language.${language}`)}
          aria-pressed={i18n.resolvedLanguage === language}
          onClick={() => void i18n.changeLanguage(language)}
        >
          {language.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
