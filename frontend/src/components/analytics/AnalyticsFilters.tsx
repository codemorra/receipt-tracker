import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  periods,
  spendingFilters,
  isCalendarDate,
  type AnalyticsState,
  type Period,
} from "../../analytics/analytics-state";
import {
  AnalyticsApiError,
  getAnalyticsMerchant,
  type AnalyticsErrorCode,
} from "../../api/analytics-api";
import Select from "../ui/Select";
import LookupField from "../ui/LookupField";

/**
 * Component for rendering analytics filters, including period selection,
 * merchant lookup, and custom date range inputs.
 * @param state The current analytics state.
 * @param onChange Callback function to update the analytics state.
 */
export default function AnalyticsFilters({
  state,
  onChange,
  children,
}: {
  state: AnalyticsState;
  onChange: (state: AnalyticsState) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);
  const [merchant, setMerchant] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [lookupError, setLookupError] = useState<AnalyticsErrorCode | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state.merchantId === null) return;
    const controller = new AbortController();
    getAnalyticsMerchant(state.merchantId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setMerchant(value);
          setLookupError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLookupError(
            error instanceof AnalyticsApiError
              ? error.code
              : "unexpected_response",
          );
      });
    return () => controller.abort();
  }, [state.merchantId, attempt]);
  const validRange = isCalendarDate(from) && isCalendarDate(to) && from <= to;
  return (
    <div className="space-y-4">
      <div
        className={`grid gap-4 ${children ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {children}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">
            {t("pages.analytics.filters.period")}
          </p>
          <Select
            compact
            label={t("pages.analytics.filters.period")}
            value={state.period}
            options={periods.map((value) => ({
              value,
              label: t(`pages.analytics.filters.presets.${value}`),
            }))}
            onChange={(value) => {
              const range = spendingFilters(state);
              onChange({
                ...state,
                period: value as Period,
                from: value === "custom" ? (range?.from ?? "") : "",
                to: value === "custom" ? (range?.to ?? "") : "",
              });
            }}
          />
        </div>
        <LookupField
          label={t("pages.analytics.filters.merchant")}
          kind="merchants"
          selectedId={state.merchantId}
          selectedName={
            merchant?.id === state.merchantId
              ? merchant.name
              : t("pages.analytics.filters.merchantId", {
                  id: state.merchantId,
                })
          }
          emptyLabel={t("pages.analytics.filters.allMerchants")}
          clearOptionLabel={t("pages.analytics.filters.allMerchants")}
          texts={{
            search: t("pages.analytics.filters.searchMerchant"),
            loading: t("pages.analytics.filters.lookupLoading"),
            empty: t("pages.analytics.filters.lookupEmpty"),
            retry: t("pages.analytics.filters.lookupRetry"),
            clear: t("pages.analytics.filters.allMerchants"),
            error: t("pages.analytics.errors.merchant_lookup_failed"),
          }}
          onSelect={(value) => {
            setMerchant(value);
            setLookupError(null);
            onChange({ ...state, merchantId: value?.id ?? null });
          }}
        />
      </div>
      {state.period === "custom" && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (validRange) onChange({ ...state, from, to });
          }}
        >
          {[
            { id: "from", value: from, set: setFrom },
            { id: "to", value: to, set: setTo },
          ].map((field) => (
            <label
              key={field.id}
              className="min-w-40 flex-1 space-y-1.5 text-xs font-medium text-muted"
            >
              <span>{t(`pages.analytics.filters.${field.id}`)}</span>
              <input
                type="date"
                required
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                className="block w-full rounded-xl border border-shell bg-canvas px-3 py-2.5 text-sm text-foreground"
              />
            </label>
          ))}
          <button
            type="submit"
            disabled={!validRange}
            className="cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover disabled:cursor-default disabled:opacity-50"
          >
            {t("pages.analytics.filters.apply")}
          </button>
          {!validRange && (
            <p role="alert" className="w-full text-sm text-warning">
              {t("pages.analytics.errors.invalid_analytics_query")}
            </p>
          )}
        </form>
      )}
      {lookupError && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="alert" className="text-warning">
            {t(`pages.analytics.errors.${lookupError}`)}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="cursor-pointer text-accent underline"
          >
            {t("pages.analytics.retry")}
          </button>
        </div>
      )}
    </div>
  );
}
