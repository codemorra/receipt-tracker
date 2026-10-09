import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  sections,
  type Route,
  type Section,
  type NavigationTarget,
} from "../../routes/routing";

// Props for the Navigation component.
interface Props {
  route: Route;
  navigate: (section: NavigationTarget) => void;
}

/**
 * Navigation component for rendering the application's navigation links.
 * @param route The current route of the application.
 * @param navigate Callback function to navigate to a different section.
 */
export default function Navigation({ route, navigate }: Props) {
  const { t } = useTranslation();
  function link(section: Section) {
    return (
      <a
        key={section}
        href={`/${section}`}
        className="group flex items-center gap-3.5 rounded-xl px-3.5 py-3.5 text-sm font-medium text-muted no-underline hover:bg-surface-hover hover:text-foreground aria-[current=page]:bg-(image:--accent-gradient) aria-[current=page]:text-accent aria-[current=page]:shadow-soft aria-[current=page]:ring-1 aria-[current=page]:ring-accent/15"
        aria-current={route === section ? "page" : undefined}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          navigate(section);
        }}
      >
        <span
          className="size-2 shrink-0 rounded-full border border-current group-aria-[current=page]:bg-current"
          aria-hidden="true"
        />
        {t(`navigation.${section}`)}
      </a>
    );
  }
  return (
    <>
      <a
        className="flex items-center gap-3 px-3 text-base font-semibold no-underline"
        href="/"
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          navigate("home");
        }}
      >
        <span
          className="grid h-9 w-8 place-items-center rounded-lg border border-accent bg-(image:--accent-gradient) font-bold text-accent shadow-soft"
          aria-hidden="true"
        >
          R
        </span>
        {t("common.appName")}
      </a>
      <nav
        className="mt-12 flex flex-1 flex-col"
        aria-label={t("navigation.label")}
      >
        <div className="grid gap-2 pb-12">
          {sections.filter((section) => section !== "settings").map(link)}
        </div>
        <div className="mt-auto border-t border-shell pt-5">
          {link("settings")}
        </div>
      </nav>
    </>
  );
}
