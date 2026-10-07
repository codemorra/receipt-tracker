import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReceiptBrowser } from "../hooks/useReceiptBrowser";
import PaginatedTable from "../components/ui/PaginatedTable";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import ReceiptDetailModal from "../components/receipts/ReceiptDetailModal";

/** Receipt archive with one shared search and fixed-size pagination. */
export default function ReceiptsPage() {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const browser = useReceiptBrowser();
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const data = browser.data;
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
        <PaginatedTable
          data={data}
          loading={browser.loading}
          error={
            browser.error ? t(`pages.receipts.errors.${browser.error}`) : null
          }
          onRetry={browser.retry}
          onPageChange={browser.setPage}
          onRowOpen={(row) => {
            setReceiptId(row.id);
            setDetailOpen(true);
          }}
          rowLabel={(receipt) =>
            t("pages.receipts.openDetail", {
              merchant: receipt.merchantName,
              date: receipt.purchaseDate,
            })
          }
          emptyMessage={t(
            data && data.totalItems > 0
              ? "pages.receipts.emptyPage"
              : browser.search.trim()
                ? "pages.receipts.noResults"
                : "pages.receipts.emptyArchive",
          )}
          labels={{
            caption: t("pages.receipts.tableLabel"),
            loading: t("pages.receipts.loading"),
            retry: t("pages.receipts.retry"),
            pagination: t("pages.receipts.pagination"),
            previous: t("pages.receipts.previous"),
            next: t("pages.receipts.next"),
            resultCount: (count) => t("pages.receipts.resultCount", { count }),
            pageStatus: (page, totalPages) =>
              t("pages.receipts.pageStatus", { page, totalPages }),
          }}
          columns={[
            {
              key: "merchant",
              label: t("pages.receipts.merchant"),
              className: "font-medium",
              render: (receipt) => receipt.merchantName,
            },
            {
              key: "date",
              label: t("pages.receipts.date"),
              className: "whitespace-nowrap",
              render: (receipt) => (
                <>
                  <time dateTime={receipt.purchaseDate}>
                    {date.format(new Date(`${receipt.purchaseDate}T00:00:00Z`))}
                  </time>
                  {receipt.purchaseTime && (
                    <span className="mt-1 block text-xs text-muted">
                      {receipt.purchaseTime}
                    </span>
                  )}
                </>
              ),
            },
            {
              key: "total",
              label: t("pages.receipts.total"),
              align: "right",
              className: "whitespace-nowrap tabular-nums",
              render: (receipt) =>
                new Intl.NumberFormat(i18n.language, {
                  style: "currency",
                  currency: receipt.currency,
                }).format(receipt.totalCents / 100),
            },
            {
              key: "warranty",
              label: t("pages.receipts.warranty"),
              align: "right",
              className: "whitespace-nowrap",
              render: (receipt) =>
                receipt.warrantyCount > 0 ? (
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
                ),
            },
          ]}
        />
      </Card>
      {receiptId !== null && (
        <ReceiptDetailModal
          receiptId={receiptId}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </>
  );
}
