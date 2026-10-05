import { useTranslation } from "react-i18next";
import type { SavedReceipt } from "../../api/receipt-api";
import Card from "../ui/Card";

/**
 * Component for displaying a summary of a saved receipt.
 * @param receipt - The saved receipt to display.
 */
export default function SavedReceiptSummary({
  receipt,
}: {
  receipt: SavedReceipt;
}) {
  const { t, i18n } = useTranslation();
  const money = (cents: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency: receipt.currency,
    }).format(cents / 100);
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  const unit = (value: string | null) =>
    value
      ? t(`pages.import.review.units.${value}`, { defaultValue: value })
      : "";
  return (
    <Card className="min-w-0 space-y-6 p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold wrap-break-word">
            {receipt.merchantName}
          </h2>
          {receipt.merchantRawName && (
            <p className="mt-1 text-xs text-muted">
              {t("pages.import.review.merchantRawName")}:{" "}
              {receipt.merchantRawName}
            </p>
          )}
        </div>
        <span className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">
          {t("pages.import.saved.status")}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-4 text-sm">
        {[
          {
            label: t("pages.import.review.purchaseDate"),
            value: date(receipt.purchaseDate),
          },
          {
            label: t("pages.import.review.purchaseTime"),
            value: receipt.purchaseTime ?? "—",
          },
          { label: t("pages.import.review.currency"), value: receipt.currency },
          {
            label: t("pages.import.review.total"),
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
          {t("pages.import.review.items")}
        </h3>
        {receipt.items.map((item) => (
          <article
            key={item.id}
            className="min-w-0 space-y-3 rounded-xl border border-shell bg-canvas/25 p-4"
          >
            <div className="flex justify-between gap-3">
              <h4 className="min-w-0 text-sm font-semibold wrap-break-word">
                {item.product?.name ?? item.rawName}
              </h4>
              <p className="shrink-0 text-sm font-semibold">
                {money(item.totalPriceCents)}
              </p>
            </div>
            <p className="text-xs text-muted">
              {t("pages.import.review.quantity")}: {item.quantity}{" "}
              {unit(item.unit)} · {t("pages.import.review.unitPrice")}:{" "}
              {item.unitPriceCents === null ? "—" : money(item.unitPriceCents)}{" "}
              · {t(`pages.import.review.lineTypes.${item.lineType}`)}
            </p>
            <details className="border-t border-shell pt-3">
              <summary className="cursor-pointer text-xs font-medium text-accent">
                {t("pages.import.saved.itemDetails")}
              </summary>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                {[
                  {
                    label: t("pages.import.review.rawName"),
                    value: item.rawName,
                  },
                  ...(item.product
                    ? [
                        {
                          label: t("pages.import.review.productName"),
                          value: item.product.name,
                        },
                        {
                          label: t("pages.import.review.brandName"),
                          value: item.product.brandName,
                        },
                        {
                          label: t("pages.import.review.productGroupName"),
                          value: item.product.productGroupName,
                        },
                        {
                          label: t("pages.import.review.packageAmount"),
                          value: item.product.packageAmount?.toString(),
                        },
                        {
                          label: t("pages.import.review.packageUnit"),
                          value: unit(item.product.packageUnit),
                        },
                        {
                          label: t("pages.import.review.category"),
                          value: item.product.categoryName
                            ? t(
                                `pages.import.review.categories.${item.product.categoryName}`,
                                { defaultValue: item.product.categoryName },
                              )
                            : null,
                        },
                      ]
                    : []),
                ].map((field) => (
                  <div key={field.label} className="min-w-0">
                    <dt className="text-muted">{field.label}</dt>
                    <dd className="mt-1 wrap-break-word">
                      {field.value || t("pages.import.review.unknown")}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            {item.warranties.length > 0 && (
              <details className="border-t border-shell pt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted">
                  {t("pages.import.review.warrantyCount", {
                    count: item.warranties.length,
                  })}
                </summary>
                <ul className="mt-3 space-y-3 text-xs">
                  {item.warranties.map((warranty) => (
                    <li key={warranty.id} className="space-y-1">
                      <p className="font-medium">
                        {t(
                          `pages.import.review.warrantyTypes.${warranty.type}`,
                        )}
                      </p>
                      <p className="text-muted">
                        {date(warranty.startDate)} – {date(warranty.endDate)}
                      </p>
                      {warranty.notes && (
                        <p className="wrap-break-word whitespace-pre-wrap text-muted">
                          {warranty.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
      </section>
      {receipt.discounts.length > 0 && (
        <section className="space-y-3 border-t border-shell pt-5">
          <h3 className="text-sm font-semibold">
            {t("pages.import.review.discounts")}
          </h3>
          {receipt.discounts.map((discount) => {
            const item = receipt.items.find(
              (item) => item.id === discount.receiptItemId,
            );
            return (
              <div
                key={discount.id}
                className="flex justify-between gap-3 rounded-xl border border-shell bg-canvas/25 p-4 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium wrap-break-word">
                    {discount.description || t("pages.import.saved.discount")}
                  </p>
                  <p className="mt-1 text-muted">
                    {item
                      ? `${t("pages.import.review.itemNumber", { number: item.position + 1 })} · ${item.rawName}`
                      : t("pages.import.review.wholeReceipt")}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">
                  −{money(discount.amountCents)}
                </p>
              </div>
            );
          })}
        </section>
      )}
    </Card>
  );
}
