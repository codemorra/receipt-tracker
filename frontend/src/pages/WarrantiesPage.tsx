import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWarrantyBrowser } from "../hooks/useWarrantyBrowser";
import PaginatedTable from "../components/ui/PaginatedTable";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import Select from "../components/ui/Select";
import {
  warrantyStatuses,
  warrantyTypes,
  type WarrantyStatus,
} from "../api/warranty-api";
import type { WarrantyType } from "../review/review-state";
import ReceiptDetailModal from "../components/receipts/ReceiptDetailModal";

/** Read-only warranty intervals with server-side search, filters and pagination. */
export default function WarrantiesPage() {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const browser = useWarrantyBrowser();
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const data = browser.data;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.warranties.title")} · ${t("common.appName")}`;
  }, [t]);
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  return (
    <>
      <PageHeader
        title={t("pages.warranties.title")}
        description={t("pages.warranties.description")}
        headingRef={heading}
      />
      <Card className="min-w-0 space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-48 flex-1 space-y-2">
            <label htmlFor="warranty-search" className="text-sm font-medium">
              {t("pages.warranties.searchLabel")}
            </label>
            <input
              id="warranty-search"
              type="search"
              value={browser.search}
              onChange={(event) => browser.setSearch(event.target.value)}
              placeholder={t("pages.warranties.searchPlaceholder")}
              className="w-full rounded-xl border border-shell bg-canvas px-4 py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>
          <div className="max-w-full space-y-2">
            <p className="text-sm font-medium">
              {t("pages.warranties.statusLabel")}
            </p>
            <Select
              fitOptions
              label={t("pages.warranties.statusLabel")}
              value={browser.status}
              options={[
                { value: "", label: t("pages.warranties.allStatuses") },
                ...warrantyStatuses.map((value) => ({
                  value,
                  label: t(`pages.warranties.statuses.${value}`),
                })),
              ]}
              onChange={(value) =>
                browser.setStatus(value as WarrantyStatus | "")
              }
            />
          </div>
          <div className="max-w-full space-y-2">
            <p className="text-sm font-medium">
              {t("pages.warranties.typeLabel")}
            </p>
            <Select
              fitOptions
              label={t("pages.warranties.typeLabel")}
              value={browser.type}
              options={[
                { value: "", label: t("pages.warranties.allTypes") },
                ...warrantyTypes.map((value) => ({
                  value,
                  label: t(`pages.warranties.types.${value}`),
                })),
              ]}
              onChange={(value) => browser.setType(value as WarrantyType | "")}
            />
          </div>
        </div>
        <PaginatedTable
          data={data}
          loading={browser.loading}
          error={
            browser.error ? t(`pages.warranties.errors.${browser.error}`) : null
          }
          onRetry={browser.retry}
          onPageChange={browser.setPage}
          onRowOpen={(row) => {
            setReceiptId(row.receiptId);
            setDetailOpen(true);
          }}
          rowLabel={(warranty) =>
            t("pages.warranties.openDetail", {
              product: warranty.displayName,
              merchant: warranty.merchantName,
              date: date.format(new Date(`${warranty.purchaseDate}T00:00:00Z`)),
            })
          }
          emptyMessage={t(
            data && data.totalItems > 0
              ? "pages.warranties.emptyPage"
              : browser.search.trim() || browser.status || browser.type
                ? "pages.warranties.noResults"
                : "pages.warranties.empty",
          )}
          labels={{
            caption: t("pages.warranties.tableLabel"),
            loading: t("pages.warranties.loading"),
            retry: t("pages.warranties.retry"),
            pagination: t("pages.warranties.pagination"),
            previous: t("pages.warranties.previous"),
            next: t("pages.warranties.next"),
            resultCount: (count) =>
              t("pages.warranties.resultCount", { count }),
            pageStatus: (page, totalPages) =>
              t("pages.warranties.pageStatus", { page, totalPages }),
          }}
          columns={[
            {
              key: "product",
              label: t("pages.warranties.product"),
              className: "font-medium",
              render: (warranty) => warranty.displayName,
            },
            {
              key: "type",
              label: t("pages.warranties.typeLabel"),
              render: (warranty) =>
                t(`pages.warranties.types.${warranty.type}`),
            },
            {
              key: "merchant",
              label: t("pages.warranties.merchant"),
              render: (warranty) => warranty.merchantName,
            },
            {
              key: "purchaseDate",
              label: t("pages.warranties.purchaseDate"),
              className: "whitespace-nowrap",
              render: (warranty) => (
                <time dateTime={warranty.purchaseDate}>
                  {date.format(new Date(`${warranty.purchaseDate}T00:00:00Z`))}
                </time>
              ),
            },
            {
              key: "startDate",
              label: t("pages.warranties.startDate"),
              className: "whitespace-nowrap",
              render: (warranty) => (
                <time dateTime={warranty.startDate}>
                  {date.format(new Date(`${warranty.startDate}T00:00:00Z`))}
                </time>
              ),
            },
            {
              key: "endDate",
              label: t("pages.warranties.endDate"),
              className: "whitespace-nowrap",
              render: (warranty) => (
                <time dateTime={warranty.endDate}>
                  {date.format(new Date(`${warranty.endDate}T00:00:00Z`))}
                </time>
              ),
            },
            {
              key: "status",
              label: t("pages.warranties.statusLabel"),
              className: "whitespace-nowrap",
              render: (warranty) => (
                <span
                  className={`rounded-lg px-2.5 py-1 text-xs ${warranty.status === "active" ? "bg-success-soft text-success" : warranty.status === "expiring_soon" ? "bg-warning-soft text-warning" : warranty.status === "not_started" ? "bg-accent-soft text-accent" : "bg-surface-hover text-muted"}`}
                >
                  {t(`pages.warranties.statuses.${warranty.status}`)}
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
