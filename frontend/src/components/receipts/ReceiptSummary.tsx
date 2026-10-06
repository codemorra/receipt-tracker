import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { ReceiptSummaryModel } from "../../receipts/receipt-summary";
import Card from "../ui/Card";

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
    <Card className="min-w-0 space-y-6 p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold wrap-break-word">
            {receipt.merchantName ?? t("pages.receiptSummary.unknown")}
          </h2>
          {receipt.merchantRawName && (
            <p className="mt-1 text-xs text-muted">
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
      <dl className="grid grid-cols-2 gap-4 text-sm">
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
        ].map((field) => (
          <div key={field.label}>
            <dt className="text-xs text-muted">{field.label}</dt>
            <dd className="mt-1 font-medium">{field.value}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-3 border-t border-shell pt-5">
        <h3 className="text-sm font-semibold">
          {t("pages.receiptSummary.items")}
        </h3>
        <ul>
          {receipt.items.map((item) => (
            <li
              key={item.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1.5 text-sm"
            >
              <span className="min-w-0 wrap-break-word">
                <strong className="font-semibold">
                  {item.name || t("pages.receiptSummary.unknown")}
                </strong>{" "}
                <span className="text-muted whitespace-nowrap">
                  {item.quantity === null
                    ? t("pages.receiptSummary.unknown")
                    : number(item.quantity)}{" "}
                  {unit(item.unit)}
                </span>
              </span>
              <span className="text-right whitespace-nowrap tabular-nums">
                {money(item.totalPriceCents)}
              </span>
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
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1.5 text-sm"
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
      {receipt.items.length > 0 && (
        <details className="border-t border-shell pt-4">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-accent">
            {t("pages.receiptSummary.moreDetails")}
          </summary>
          <ul className="mt-4 space-y-5">
            {receipt.items.map((item, index) => (
              <li key={item.key} className="space-y-2">
                <p className="text-xs font-semibold wrap-break-word">
                  {item.name || item.rawName}
                </p>
                <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                  {[
                    {
                      label: t("pages.receiptSummary.unitPrice"),
                      value: money(item.unitPriceCents),
                    },
                    {
                      label: t("pages.receiptSummary.lineType"),
                      value: t(
                        `pages.import.review.lineTypes.${item.lineType}`,
                      ),
                    },
                    {
                      label: t("pages.receiptSummary.rawName"),
                      value: item.rawName,
                    },
                    {
                      label: t("pages.receiptSummary.brandName"),
                      value: item.product?.brandName,
                    },
                    {
                      label: t("pages.receiptSummary.productGroupName"),
                      value: item.product?.productGroupName,
                    },
                    {
                      label: t("pages.receiptSummary.category"),
                      value: item.product?.categoryName
                        ? t(
                            `pages.import.review.categories.${item.product.categoryName}`,
                            { defaultValue: item.product.categoryName },
                          )
                        : null,
                    },
                    {
                      label: t("pages.receiptSummary.packageAmount"),
                      value:
                        item.product?.packageAmount === null ||
                        item.product?.packageAmount === undefined
                          ? null
                          : number(item.product.packageAmount),
                    },
                    {
                      label: t("pages.receiptSummary.packageUnit"),
                      value: unit(item.product?.packageUnit ?? null),
                    },
                  ]
                    .filter((field) => field.value)
                    .map((field) => (
                      <div key={field.label} className="min-w-0">
                        <dt className="text-muted">{field.label}</dt>
                        <dd className="mt-0.5 wrap-break-word">
                          {field.value}
                        </dd>
                      </div>
                    ))}
                </dl>
                {index < receipt.items.length - 1 && (
                  <hr
                    aria-hidden="true"
                    className="w-3/5 border-0 border-t border-shell"
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
