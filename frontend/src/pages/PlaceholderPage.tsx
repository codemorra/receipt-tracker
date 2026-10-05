import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Route } from "../routes/routing";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";

// Props for the PlaceholderPage component.
interface Props {
  route: Exclude<Route, "legacy">;
}

/**
 * PlaceholderPage component for rendering a placeholder page based on the route.
 * @param route The current route, excluding the "legacy" route.
 */
export default function PlaceholderPage({ route }: Props) {
  const { t } = useTranslation();
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current !== route) {
      pageHeading.current?.focus();
      previousRoute.current = route;
    }
    document.title = `${t(`pages.${route}.title`)} · ${t("common.appName")}`;
  }, [route, t]);

  return (
    <>
      <PageHeader
        title={t(`pages.${route}.title`)}
        description={t(`pages.${route}.description`)}
        headingRef={pageHeading}
      />
      {route !== "notFound" && (
        <Card>
          <span className="inline-block rounded-md bg-(image:--accent-gradient) px-3 py-1.5 text-xs font-semibold text-accent">
            {t("pages.placeholder.status")}
          </span>
          <p className="mt-4 leading-relaxed text-muted">
            {t("pages.placeholder.hint")}
          </p>
          {route === "import" && (
            <a
              className="mt-6 inline-block text-sm text-accent underline underline-offset-4 hover:text-accent-hover"
              href="/legacy-import"
            >
              {t("pages.import.legacyLink")} <span aria-hidden="true">↗</span>
            </a>
          )}
        </Card>
      )}
    </>
  );
}
