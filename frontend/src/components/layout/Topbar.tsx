import { useTranslation } from "react-i18next";
import GlobalControls from "../appearance/GlobalControls";

// Props for the Topbar component.
interface Props {
  onOpenNavigation: () => void;
}

/**
 * Topbar component for rendering the application's top navigation bar.
 * @param onOpenNavigation Callback function to open the mobile navigation drawer.
 */
export default function Topbar({ onOpenNavigation }: Props) {
  const { t } = useTranslation();
  return (
    <header className="relative z-10 flex min-h-22 flex-wrap items-center justify-between gap-4 border-b border-shell bg-(image:--chrome-gradient) px-5 py-4 shadow-soft max-sm:items-start max-sm:gap-2.5 lg:px-10">
      <button
        type="button"
        className="cursor-pointer rounded-lg border border-shell bg-surface p-2.5 text-foreground hover:bg-surface-hover max-sm:mt-0.5 lg:hidden"
        aria-haspopup="dialog"
        aria-controls="mobile-navigation"
        onClick={onOpenNavigation}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="sr-only">{t("common.actions.openMenu")}</span>
      </button>
      <GlobalControls />
    </header>
  );
}
