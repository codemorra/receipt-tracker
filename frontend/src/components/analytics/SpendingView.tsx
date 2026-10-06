import { useTranslation } from "react-i18next";
import { useSpending } from "../../hooks/useSpending";
import Card from "../ui/Card";
import SpendingChart from "./SpendingChart";

/**
 * Component for rendering the spending view, including summary metrics,
 * spending chart, and merchant breakdown.
 * @param query The query string for fetching spending analytics data.
 */
export default function SpendingView({ query }: { query: string | null }) {
  const { t, i18n } = useTranslation();
  const spending = useSpending(query);
  const data = spending.data;
  const money = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: data?.currency ?? "EUR",
  });
  const percentage = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const showShare =
    data &&
    data.summary.totalCents > 0 &&
    data.merchants.every((row) => row.totalCents >= 0);
  return (
    <div className="space-y-5" aria-busy={spending.loading}>
      <div className="min-h-6 text-sm" aria-live="polite">
        {query === null ? (
          <p role="alert" className="text-warning">
            {t("pages.analytics.errors.invalid_analytics_query")}
          </p>
        ) : spending.loading ? (
          <p role="status" className="text-muted">
            {t(data ? "pages.analytics.updating" : "pages.analytics.loading")}
          </p>
        ) : spending.error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-warning">
              {t(`pages.analytics.errors.${spending.error}`)}
            </p>
            <button
              type="button"
              onClick={spending.retry}
              className="cursor-pointer text-accent underline"
            >
              {t("pages.analytics.retry")}
            </button>
          </div>
        ) : null}
      </div>
      <div
        className={`space-y-5 ${spending.loading || query === null ? "opacity-60" : ""}`}
      >
        <Card className="p-5 sm:p-6">
          <dl className="grid gap-5 sm:grid-cols-3">
            {[
              {
                label: "total",
                value: data
                  ? data.summary.receiptCount === 0
                    ? "0"
                    : money.format(data.summary.totalCents / 100)
                  : "—",
              },
              {
                label: "receipts",
                value: data
                  ? new Intl.NumberFormat(i18n.language).format(
                      data.summary.receiptCount,
                    )
                  : "—",
              },
              {
                label: "average",
                value:
                  data?.summary.averageReceiptCents == null
                    ? "—"
                    : money.format(data.summary.averageReceiptCents / 100),
              },
            ].map((metric) => (
              <div key={metric.label}>
                <dt className="text-xs text-muted">
                  {t(`pages.analytics.spending.${metric.label}`)}
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="min-w-0 space-y-5 p-5 sm:p-6">
          <h2 className="text-base font-semibold">
            {t("pages.analytics.spending.timeline")}
          </h2>
          {data && data.summary.receiptCount > 0 ? (
            <SpendingChart data={data} />
          ) : (
            <div className="flex min-h-72 items-center justify-center text-sm text-muted">
              {data ? t("pages.analytics.spending.empty") : "—"}
            </div>
          )}
        </Card>
        <Card className="min-w-0 space-y-4 p-5 sm:p-6">
          <h2 className="text-base font-semibold">
            {t("pages.analytics.spending.merchants")}
          </h2>
          <div className="min-h-32 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                {t("pages.analytics.spending.merchants")}
              </caption>
              <thead>
                <tr className="border-b border-shell text-xs text-muted">
                  <th scope="col" className="py-3 pr-3">
                    {t("pages.analytics.filters.merchant")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    {t("pages.analytics.spending.receipts")}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    {t("pages.analytics.spending.total")}
                  </th>
                  {showShare && (
                    <th scope="col" className="py-3 pl-3 text-right">
                      {t("pages.analytics.spending.share")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data?.merchants.map((row) => (
                  <tr
                    key={row.merchantId}
                    className="border-b border-shell last:border-0"
                  >
                    <td className="py-3 pr-3 font-medium">{row.name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.receiptCount}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                      {money.format(row.totalCents / 100)}
                    </td>
                    {showShare && (
                      <td className="py-3 pl-3 text-right tabular-nums">
                        {percentage.format(
                          row.totalCents / data!.summary.totalCents,
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {data?.merchants.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-muted">
                      {t("pages.analytics.spending.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
