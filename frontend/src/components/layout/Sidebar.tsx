import { useEffect, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Route, Section } from "../../routes/routing";
import Navigation from "./Navigation";

// Props for the Sidebar component.
interface Props {
  route: Exclude<Route, "legacy">;
  navigate: (section: Section) => void;
  drawer: RefObject<HTMLDialogElement | null>;
}

/**
 * Sidebar component for rendering the application's sidebar navigation.
 * @param route The current route of the application.
 * @param navigate Callback function to navigate to a different section.
 * @param drawer Ref object for the mobile navigation drawer.
 */
export default function Sidebar({ route, navigate, drawer }: Props) {
  const { t } = useTranslation();
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) drawer.current?.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [drawer]);

  function navigateFromDrawer(section: Section) {
    drawer.current?.close();
    navigate(section);
  }

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-68 flex-col overflow-y-auto border-r border-shell bg-(image:--chrome-gradient) px-4 pt-8 pb-5 shadow-soft lg:flex">
        <Navigation route={route} navigate={navigate} />
      </aside>
      <dialog
        ref={drawer}
        id="mobile-navigation"
        className="m-0 h-dvh max-h-dvh w-[min(19rem,90vw)] max-w-[90vw] border-0 bg-surface p-0 text-foreground backdrop:bg-black/45"
        aria-label={t("navigation.label")}
        onClick={(event) => {
          if (event.target === drawer.current) drawer.current?.close();
        }}
      >
        <div className="flex min-h-full flex-col bg-(image:--chrome-gradient) px-4 pt-8 pb-5">
          <button
            type="button"
            className="mb-6.5 cursor-pointer self-end rounded-lg border border-shell bg-surface px-3 py-2 text-sm hover:bg-surface-hover"
            autoFocus
            onClick={() => drawer.current?.close()}
          >
            {t("common.actions.closeMenu")}
          </button>
          <Navigation route={route} navigate={navigateFromDrawer} />
        </div>
      </dialog>
    </>
  );
}
