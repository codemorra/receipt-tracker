import { useEffect, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import PageHeader from "../components/ui/PageHeader";
import type { Section } from "../routes/routing";

/**
 * HomePage component
 * Renders the home page with navigation links to import and receipts sections.
 * @returns JSX.Element representing the home page.
 */
export default function HomePage({
  navigate,
}: {
  navigate: (section: Section) => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = t("common.appName");
  }, [t]);

  function follow(event: MouseEvent<HTMLAnchorElement>, section: Section) {
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
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={t("common.appName")}
        description={t("pages.home.description")}
        headingRef={heading}
      />
      <div className="flex flex-col items-start gap-5">
        <a
          href="/import"
          onClick={(event) => follow(event, "import")}
          className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-surface no-underline hover:bg-accent-hover"
        >
          {t("pages.home.import")}
        </a>
        <a
          href="/receipts"
          onClick={(event) => follow(event, "receipts")}
          className="rounded text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          {t("pages.home.receipts")}
        </a>
      </div>
    </div>
  );
}
