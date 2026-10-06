import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useReceiptBrowser } from "../hooks/useReceiptBrowser";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";

/** Receipt archive with one shared search and fixed-size pagination. */
export default function ReceiptsPage({
  onOpenReceipt,
}: {
  onOpenReceipt: (id: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const browser = useReceiptBrowser();
  const data = browser.data;
  const stale = browser.loading || browser.error !== null;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.receipts.title")} · ${t("common.appName")}`;
  }, [t]);
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const buttonClass =
    "cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
  return (
    <>
      <PageHeader
        title={t("pages.receipts.title")}
        description={t("pages.receipts.description")}
        headingRef={heading}
      />
      <Card className="min-w-0 space-y-5 p-5 sm:p-6">
        <div className="space-y-2">
          <label htmlFor="receipt-search" className="text-sm font-medium">
            {t("pages.receipts.searchLabel")}
          </label>
          <input
            id="receipt-search"
            type="search"
            value={browser.search}
            onChange={(event) => browser.setSearch(event.target.value)}
            placeholder={t("pages.receipts.searchPlaceholder")}
            className="w-full rounded-xl border border-shell bg-canvas px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <div className="min-h-6 text-sm" aria-live="polite">
          {browser.loading ? (
            <p role="status" className="text-muted">
              {t("pages.receipts.loading")}
            </p>
          ) : browser.error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-muted">
                {t(`pages.receipts.errors.${browser.error}`)}
              </p>
              <button
                type="button"
                onClick={browser.retry}
                className={buttonClass}
              >
                {t("pages.receipts.retry")}
              </button>
            </div>
          ) : (
            data && (
              <p className="text-muted">
                {t("pages.receipts.resultCount", { count: data.totalItems })}
              </p>
            )
          )}
        </div>
        <div className="min-h-80 overflow-x-auto" aria-busy={browser.loading}>
          <table
            className={`w-full text-left text-sm ${stale ? "opacity-60" : ""}`}
          >
            <caption className="sr-only">
              {t("pages.receipts.tableLabel")}
            </caption>
            <thead>
              <tr className="border-b border-shell text-xs text-muted">
                <th scope="col" className="px-3 py-3">
                  {t("pages.receipts.merchant")}
                </th>
                <th scope="col" className="px-3 py-3">
                  {t("pages.receipts.date")}
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  {t("pages.receipts.total")}
                </th>
                <th scope="col" className="px-3 py-3 text-right">
                  {t("pages.receipts.warranty")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((receipt) => (
                <tr
                  key={receipt.id}
                  onClick={(event) => {
                    if (stale) return;
                    event.currentTarget.querySelector("button")?.focus();
                    onOpenReceipt(receipt.id);
                  }}
                  className={`border-b border-shell last:border-0 ${stale ? "" : "cursor-pointer hover:bg-surface-hover"}`}
                >
                  <td className="px-3 py-4 font-medium">
                    <button
                      type="button"
                      disabled={stale}
                      aria-label={t("pages.receipts.openDetail", {
                        merchant: receipt.merchantName,
                        date: receipt.purchaseDate,
                      })}
                      className="cursor-pointer rounded text-left wrap-break-word focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent disabled:cursor-default"
                    >
                      {receipt.merchantName}
                    </button>
                  </td>
                  <td className="px-3 py-4 whitespace-nowrap">
                    <time dateTime={receipt.purchaseDate}>
                      {date.format(
                        new Date(`${receipt.purchaseDate}T00:00:00Z`),
                      )}
                    </time>
                    {receipt.purchaseTime && (
                      <span className="mt-1 block text-xs text-muted">
                        {receipt.purchaseTime}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-right whitespace-nowrap tabular-nums">
                    {new Intl.NumberFormat(i18n.language, {
                      style: "currency",
                      currency: receipt.currency,
                    }).format(receipt.totalCents / 100)}
                  </td>
                  <td className="px-3 py-4 text-right whitespace-nowrap">
                    {receipt.warrantyCount > 0 ? (
                      <span className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs text-accent">
                        <span aria-hidden="true">{receipt.warrantyCount}</span>
                        <span className="sr-only">
                          {t("pages.receipts.warrantyCount", {
                            count: receipt.warrantyCount,
                          })}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">
                          {t("pages.receipts.noWarranty")}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!stale && data?.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-muted">
                    {t(
                      data.totalItems > 0
                        ? "pages.receipts.emptyPage"
                        : browser.search.trim()
                          ? "pages.receipts.noResults"
                          : "pages.receipts.emptyArchive",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 0 && (
          <nav
            aria-label={t("pages.receipts.pagination")}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-shell pt-5"
          >
            <button
              type="button"
              disabled={stale || data.page <= 1}
              onClick={() => browser.setPage(data.page - 1)}
              className={buttonClass}
            >
              {t("pages.receipts.previous")}
            </button>
            <p className="text-sm text-muted">
              {t("pages.receipts.pageStatus", {
                page: data.page,
                totalPages: data.totalPages,
              })}
            </p>
            <button
              type="button"
              disabled={stale || data.page >= data.totalPages}
              onClick={() => browser.setPage(data.page + 1)}
              className={buttonClass}
            >
              {t("pages.receipts.next")}
            </button>
          </nav>
        )}
      </Card>
    </>
  );
}
