import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnalyticsState } from "../../analytics/analytics-state";
import type { LookupOption } from "../../api/review-api";
import { usePriceHistory } from "../../hooks/usePriceHistory";
import LookupField from "../ui/LookupField";
import Card from "../ui/Card";
import ReceiptDetailModal from "../receipts/ReceiptDetailModal";
import AnalyticsFilters from "./AnalyticsFilters";
import PriceHistoryChart from "./PriceHistoryChart";

/**
 * Component for rendering the price history view for a specific product.
 * Includes filters, product lookup, and the price history chart.
 * @param state The current analytics state including selected product and filters.
 * @param query The query string containing optional filters such as date range and merchant ID.
 * @param onChange Callback function to update the analytics state.
 */
export default function PriceHistoryView({
  state,
  query,
  onChange,
}: {
  state: AnalyticsState;
  query: string | null;
  onChange: (state: AnalyticsState) => void;
}) {
  const { t, i18n } = useTranslation();
  const price = usePriceHistory(state.productId, query);
  const [selected, setSelected] = useState<LookupOption | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const data = price.data;
  const number = new Intl.NumberFormat(i18n.language);
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const money = (cents: number | null, currency: string | null) =>
    cents === null || currency === null
      ? "—"
      : new Intl.NumberFormat(i18n.language, {
          style: "currency",
          currency,
        }).format(cents / 100);
  const packageLabel = (value: {
    packageAmount?: number | null;
    packageUnit?: string | null;
  }) =>
    value.packageAmount != null && value.packageUnit
      ? `${number.format(value.packageAmount)} ${t(`pages.import.review.units.${value.packageUnit}`, { defaultValue: value.packageUnit })}`
      : "";
  const stale = price.loading || query === null;
  return (
    <div className="space-y-5">
      <Card className="space-y-5 p-5 sm:p-6">
        <AnalyticsFilters
          key={`${state.period}:${state.from}:${state.to}`}
          state={state}
          onChange={onChange}
        >
          <LookupField
            label={t("pages.analytics.priceHistory.product")}
            kind="products"
            selectedId={state.productId}
            selectedName={
              data?.product.name ??
              (selected?.id === state.productId
                ? selected.name
                : t("pages.analytics.priceHistory.productId", {
                    id: state.productId,
                  }))
            }
            emptyLabel={t("pages.analytics.priceHistory.chooseProduct")}
            texts={{
              search: t("pages.analytics.priceHistory.search"),
              loading: t("pages.analytics.priceHistory.searchLoading"),
              empty: t("pages.analytics.priceHistory.searchEmpty"),
              retry: t("pages.analytics.priceHistory.searchRetry"),
              clear: t("pages.analytics.priceHistory.clear"),
              error: t("pages.analytics.errors.product_lookup_failed"),
            }}
            optionLabel={(option) =>
              [
                option.name,
                option.brandName,
                option.productGroupName,
                packageLabel(option),
              ]
                .filter(Boolean)
                .join(" · ")
            }
            onSelect={(option) => {
              setSelected(option);
              onChange({ ...state, productId: option?.id ?? null });
            }}
          />
        </AnalyticsFilters>
      </Card>
      {state.productId === null ? (
        <Card>
          <p className="text-sm text-muted">
            {t("pages.analytics.priceHistory.selectPrompt")}
          </p>
        </Card>
      ) : (
        <div aria-busy={price.loading} className="space-y-5">
          <div className="min-h-6 text-sm" aria-live="polite">
            {query === null ? (
              <p role="alert" className="text-warning">
                {t("pages.analytics.errors.invalid_analytics_query")}
              </p>
            ) : price.loading ? (
              <p role="status" className="text-muted">
                {t(
                  data
                    ? "pages.analytics.updating"
                    : "pages.analytics.priceHistory.loading",
                )}
              </p>
            ) : price.error ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-warning">
                  {t(`pages.analytics.errors.${price.error}`)}
                </p>
                <button
                  type="button"
                  onClick={price.retry}
                  className="cursor-pointer text-accent underline"
                >
                  {t("pages.analytics.retry")}
                </button>
              </div>
            ) : null}
          </div>
          <div className={`space-y-5 ${stale ? "opacity-60" : ""}`}>
            <Card className="space-y-5 p-5 sm:p-6">
              <div className="space-y-2">
                <h2 className="text-base font-semibold">
                  {data?.product.name ??
                    t("pages.analytics.priceHistory.summary")}
                </h2>
                {data && (
                  <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {data.product.brandName && (
                      <div>
                        <dt className="inline text-muted">
                          {t("pages.analytics.priceHistory.brand")}:{" "}
                        </dt>
                        <dd className="inline">{data.product.brandName}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline text-muted">
                        {t("pages.analytics.priceHistory.group")}:{" "}
                      </dt>
                      <dd className="inline">
                        {data.product.productGroupName}
                      </dd>
                    </div>
                    {packageLabel(data.product) && (
                      <div>
                        <dt className="inline text-muted">
                          {t("pages.analytics.priceHistory.package")}:{" "}
                        </dt>
                        <dd className="inline">{packageLabel(data.product)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                {[
                  { label: "latest", value: data?.statistics.latestCents },
                  { label: "lowest", value: data?.statistics.minimumCents },
                  { label: "highest", value: data?.statistics.maximumCents },
                  { label: "average", value: data?.statistics.averageCents },
                ].map((metric) => (
                  <div key={metric.label}>
                    <dt className="text-xs text-muted">
                      {t(`pages.analytics.priceHistory.${metric.label}`)}
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold tabular-nums">
                      {money(metric.value ?? null, data?.currency ?? null)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card className="min-w-0 space-y-5 p-5 sm:p-6">
              <h2 className="text-base font-semibold">
                {t("pages.analytics.priceHistory.timeline")}
              </h2>
              {data && data.statistics.latestCents !== null ? (
                <PriceHistoryChart data={data} />
              ) : (
                <div className="flex min-h-72 items-center justify-center text-sm text-muted">
                  {data
                    ? t(
                        data.history.length === 0
                          ? "pages.analytics.priceHistory.empty"
                          : "pages.analytics.priceHistory.noPrices",
                      )
                    : "—"}
                </div>
              )}
            </Card>
            <Card className="min-w-0 space-y-4 p-5 sm:p-6">
              <h2 className="text-base font-semibold">
                {t("pages.analytics.priceHistory.purchases")}
              </h2>
              <div className="min-h-32 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    {t("pages.analytics.priceHistory.purchases")}
                  </caption>
                  <thead>
                    <tr className="border-b border-shell text-xs text-muted">
                      {[
                        "date",
                        "merchant",
                        "unitPrice",
                        "quantity",
                        "receipt",
                      ].map((label, index) => (
                        <th
                          key={label}
                          scope="col"
                          className={`px-3 py-3 ${index > 1 ? "text-right" : ""}`}
                        >
                          {t(`pages.analytics.priceHistory.${label}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.history.map((row) => (
                      <tr
                        key={row.receiptItemId}
                        className="border-b border-shell last:border-0"
                      >
                        <td className="px-3 py-3 whitespace-nowrap">
                          <time dateTime={row.purchaseDate}>
                            {date.format(
                              new Date(`${row.purchaseDate}T00:00:00Z`),
                            )}
                          </time>
                          {row.purchaseTime && (
                            <span className="mt-1 block text-xs text-muted">
                              {row.purchaseTime}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">{row.merchantName}</td>
                        <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                          {money(row.unitPriceCents, row.currency)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {number.format(row.quantity)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            disabled={stale}
                            aria-label={t(
                              "pages.analytics.priceHistory.openReceipt",
                              { id: row.receiptId },
                            )}
                            onClick={() => {
                              setReceiptId(row.receiptId);
                              setDetailOpen(true);
                            }}
                            className="cursor-pointer rounded text-accent underline underline-offset-4 disabled:cursor-default disabled:opacity-50"
                          >
                            #{row.receiptId}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {data?.history.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted">
                          {t("pages.analytics.priceHistory.empty")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
      {receiptId !== null && (
        <ReceiptDetailModal
          receiptId={receiptId}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </div>
  );
}
