import { useTranslation } from "react-i18next";
import { useId, useState, type ReactNode } from "react";
import type { ReceiptSummaryModel } from "../../receipts/receipt-summary";
import Card from "../ui/Card";
import ReviewMatchBadge from "../import/ReviewMatchBadge";

/**
 * Shared read-only receipt summary for saved receipts and the current import draft.
 * @param receipt - The read-only model to display.
 * @param status - Optional status content to display alongside the receipt summary.
 */
export default function ReceiptSummary({
  receipt,
  status,
}: {
  receipt: ReceiptSummaryModel;
  status?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const [showProductDetails, setShowProductDetails] = useState(false);
  const itemsId = useId();
  const newProductCount = receipt.items.filter(
    (item) =>
      item.match &&
      !item.match.selected &&
      (item.match.status === "NEW" || item.match.status === null),
  ).length;
  const money = (cents: number | null) => {
    if (cents === null) return t("pages.receiptSummary.unknown");
    return new Intl.NumberFormat(
      i18n.language,
      receipt.currency
        ? {
            style: "currency",
            currency: receipt.currency,
          }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    ).format(cents / 100);
  };
  const date = (value: string | null) =>
    value === null
      ? t("pages.receiptSummary.unknown")
      : new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(`${value}T00:00:00Z`));
  const unit = (value: string | null) =>
    value
      ? t(`pages.import.review.units.${value}`, { defaultValue: value })
      : "";
  const number = (value: number) =>
    new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 20 }).format(
      value,
    );
  return (
    <Card className="@container min-w-0 space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold wrap-break-word">
            {receipt.merchantName ?? t("pages.receiptSummary.unknown")}
          </h2>
          {receipt.merchantRawName && (
            <p className="mt-1 text-xs wrap-break-word text-muted">
              {t("pages.receiptSummary.merchantRawName")}:{" "}
              {receipt.merchantRawName}
            </p>
          )}
        </div>
        {status && (
          <span className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">
            {status}
          </span>
        )}
      </header>
      <dl className="flex flex-wrap justify-end gap-x-10 gap-y-3 text-sm">
        {[
          {
            label: t("pages.receiptSummary.purchaseDate"),
            value: date(receipt.purchaseDate),
          },
          {
            label: t("pages.receiptSummary.purchaseTime"),
            value: receipt.purchaseTime ?? t("pages.receiptSummary.unknown"),
          },
          {
            label: t("pages.receiptSummary.currency"),
            value: receipt.currency ?? t("pages.receiptSummary.unknown"),
          },
          {
            label: t("pages.receiptSummary.total"),
            value: money(receipt.totalCents),
          },
        ].map((field, index) => (
          <div
            key={field.label}
            className={index === 3 ? "text-right" : undefined}
          >
            <dt className="text-xs text-muted">{field.label}</dt>
            <dd className="mt-1 font-medium">{field.value}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-3 border-t border-shell pt-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h3 className="text-sm font-semibold">
            {t("pages.receiptSummary.items")}
          </h3>
          {receipt.items.length > 0 && (
            <button
              type="button"
              aria-expanded={showProductDetails}
              aria-controls={itemsId}
              onClick={() => setShowProductDetails((visible) => !visible)}
              className="cursor-pointer rounded text-xs font-medium text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              <span aria-hidden="true">{showProductDetails ? "▾" : "▸"}</span>{" "}
              {t("pages.receiptSummary.moreDetails")}
            </button>
          )}
          {newProductCount > 0 && (
            <span className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
              {t("pages.receiptSummary.newProducts", {
                count: newProductCount,
              })}
            </span>
          )}
        </div>
        <ul id={itemsId} className="pl-1 @min-[30rem]:pl-3">
          {receipt.items.map((item, index) => (
            <li
              key={item.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 py-1.5 text-sm @min-[30rem]:gap-x-4"
            >
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 gap-y-1 wrap-break-word">
                <strong className="font-semibold">
                  {item.name || t("pages.receiptSummary.unknown")}
                </strong>{" "}
                <span className="text-muted whitespace-nowrap">
                  {item.quantity === null
                    ? t("pages.receiptSummary.unknown")
                    : number(item.quantity)}{" "}
                  {unit(item.unit)}
                </span>
                {showProductDetails && item.match && (
                  <ReviewMatchBadge
                    status={item.match.status}
                    selected={item.match.selected}
                  />
                )}
              </span>
              <span className="text-right whitespace-nowrap tabular-nums">
                {money(item.totalPriceCents)}
              </span>
              {showProductDetails && (
                <div className="col-span-2 min-w-0 space-y-3 pt-2 pb-2">
                  <div className="space-y-2 text-xs">
                    {[
                      [
                        {
                          label: t("pages.receiptSummary.rawName"),
                          value: item.rawName,
                        },
                        {
                          label: t("pages.receiptSummary.lineType"),
                          value: t(
                            `pages.import.review.lineTypes.${item.lineType}`,
                          ),
                        },
                        {
                          label: t("pages.receiptSummary.unitPrice"),
                          value: money(item.unitPriceCents),
                        },
                        {
                          label: t("pages.receiptSummary.packageUnit"),
                          value: unit(item.product?.packageUnit ?? null),
                        },
                        {
                          label: t("pages.receiptSummary.packageAmount"),
                          value:
                            item.product?.packageAmount == null
                              ? null
                              : number(item.product.packageAmount),
                        },
                      ],
                      [
                        {
                          label: t("pages.receiptSummary.category"),
                          value: item.product?.categoryName
                            ? t(
                                `pages.import.review.categories.${item.product.categoryName}`,
                                {
                                  defaultValue: item.product.categoryName,
                                },
                              )
                            : null,
                        },
                        {
                          label: t("pages.receiptSummary.productGroupName"),
                          value: item.product?.productGroupName,
                        },
                        {
                          label: t("pages.receiptSummary.brandName"),
                          value: item.product?.brandName?.trim() || "—",
                        },
                      ],
                    ].map((row, rowIndex) =>
                      row.some((field) => field.value) ? (
                        <dl
                          key={rowIndex}
                          className="grid grid-cols-2 gap-x-4 gap-y-2 @min-[40rem]:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]"
                        >
                          {row.map((field, column) =>
                            field.value ? (
                              <div
                                key={field.label}
                                className={`min-w-0 ${["@min-[40rem]:col-start-1", "@min-[40rem]:col-start-2", "@min-[40rem]:col-start-3", "@min-[40rem]:col-start-4", "@min-[40rem]:col-start-5"][column]}`}
                              >
                                <dt className="text-muted">{field.label}</dt>
                                <dd className="mt-0.5 wrap-break-word">
                                  {field.value}
                                </dd>
                              </div>
                            ) : null,
                          )}
                        </dl>
                      ) : null,
                    )}
                  </div>
                  {index < receipt.items.length - 1 && (
                    <hr
                      aria-hidden="true"
                      className="w-96/100 border-0 border-t border-shell"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      {receipt.discounts.length > 0 && (
        <section className="space-y-3 border-t border-shell pt-5">
          <h3 className="text-sm font-semibold">
            {t("pages.receiptSummary.discounts")}
          </h3>
          <ul>
            {receipt.discounts.map((discount) => {
              const item = receipt.items.find(
                (item) => item.key === discount.itemKey,
              );
              return (
                <li
                  key={discount.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 py-1.5 text-sm @min-[30rem]:gap-x-4"
                >
                  <span className="min-w-0 wrap-break-word">
                    <strong className="font-semibold">
                      {discount.description ||
                        t("pages.receiptSummary.discount")}
                    </strong>{" "}
                    <span className="text-muted">
                      (
                      {item
                        ? item.name || item.rawName
                        : t("pages.receiptSummary.wholeReceipt")}
                      )
                    </span>
                  </span>
                  <span className="text-right whitespace-nowrap tabular-nums">
                    {money(
                      discount.amountCents === null
                        ? null
                        : -discount.amountCents,
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {receipt.items.some((item) => item.warranties.length > 0) && (
        <section className="space-y-3 border-t border-shell pt-5">
          <h3 className="text-sm font-semibold">
            {t("pages.receiptSummary.warranties")}
          </h3>
          <ul className="space-y-3 text-sm">
            {receipt.items.flatMap((item) =>
              item.warranties.map((warranty) => (
                <li key={warranty.key} className="space-y-1">
                  <p>
                    <strong className="font-semibold">{item.name}</strong>{" "}
                    <span className="text-muted">
                      ·{" "}
                      {t(`pages.import.review.warrantyTypes.${warranty.type}`)}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {date(warranty.startDate)} – {date(warranty.endDate)}
                  </p>
                  {warranty.notes && (
                    <p className="text-xs wrap-break-word whitespace-pre-wrap text-muted">
                      {warranty.notes}
                    </p>
                  )}
                </li>
              )),
            )}
          </ul>
        </section>
      )}
    </Card>
  );
}
