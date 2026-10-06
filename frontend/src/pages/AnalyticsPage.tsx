import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  analyticsUrl,
  parseAnalyticsSearch,
  spendingFilters,
  type AnalyticsState,
} from "../analytics/analytics-state";
import { spendingQuery } from "../api/analytics-api";
import PageHeader from "../components/ui/PageHeader";
import Card from "../components/ui/Card";
import AnalyticsFilters from "../components/analytics/AnalyticsFilters";
import SpendingView from "../components/analytics/SpendingView";

/**
 * Page component for displaying analytics, including spending and price history tabs.
 * @param search The current search string from the URL.
 * @param navigate Function to navigate to a different URL.
 */
export default function AnalyticsPage({
  search,
  navigate,
}: {
  search: string;
  navigate: (url: string) => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const { state, invalid } = parseAnalyticsSearch(search);
  const filters = spendingFilters(state);
  const change = (next: AnalyticsState) => navigate(analyticsUrl(next));
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.analytics.title")} · ${t("common.appName")}`;
  }, [t]);
  return (
    <>
      <PageHeader
        title={t("pages.analytics.title")}
        description={t("pages.analytics.description")}
        headingRef={heading}
      />
      <nav
        aria-label={t("pages.analytics.tabs.label")}
        className="mb-5 flex gap-2 border-b border-shell pb-3"
      >
        {(["spending", "price-history"] as const).map((tab) => (
          <a
            key={tab}
            href={analyticsUrl({ ...state, tab })}
            aria-current={state.tab === tab ? "page" : undefined}
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                change({ ...state, tab });
              }
            }}
            className="rounded-xl px-4 py-2.5 text-sm text-muted hover:bg-surface-hover aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
          >
            {t(`pages.analytics.tabs.${tab}`)}
          </a>
        ))}
      </nav>
      {state.tab === "spending" ? (
        <>
          <Card className="mb-5 p-5 sm:p-6">
            <AnalyticsFilters
              key={`${state.period}:${state.from}:${state.to}`}
              state={state}
              onChange={change}
            />
          </Card>
          <SpendingView
            query={invalid || !filters ? null : spendingQuery(filters)}
          />
        </>
      ) : (
        <Card>
          <p className="text-sm text-muted">
            {t("pages.analytics.priceHistory.pending")}
          </p>
        </Card>
      )}
    </>
  );
}
