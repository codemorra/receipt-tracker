import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ReceiptSummaryModel } from "../../receipts/receipt-summary";
import type { ReviewIssue } from "../../review/review-state";

/**
 * Renders a list of items in a receipt for review, allowing selection and displaying issues.
 * @param receipt - The summary of the receipt containing the items.
 * @param selected - The key of the currently selected item.
 * @param issues - The list of review issues associated with the items.
 * @param onSelect - Callback invoked when an item is selected.
 * @param editor - The editor component for the selected item.
 */
export default function ReviewItemList({
  receipt,
  selected,
  issues,
  onSelect,
  editor,
}: {
  receipt: ReceiptSummaryModel;
  selected: string | null;
  issues: ReviewIssue[];
  onSelect: (id: string) => void;
  editor: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const money = (cents: number | null) =>
    cents === null
      ? "—"
      : new Intl.NumberFormat(
          i18n.language,
          receipt.currency
            ? { style: "currency", currency: receipt.currency }
            : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
        ).format(cents / 100);
  return (
    <ul className="space-y-1 rounded-xl border border-shell p-2">
      {receipt.items.map((item, index) => (
        <li key={item.key}>
          <button
            id={`${id}-${item.key}-toggle`}
            type="button"
            aria-expanded={selected === item.key}
            aria-controls={
              selected === item.key ? `${id}-${item.key}-editor` : undefined
            }
            onClick={() => onSelect(item.key)}
            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover aria-expanded:bg-accent-soft aria-expanded:ring-1 aria-expanded:ring-accent/30"
          >
            <span className="flex items-center gap-2 text-xs text-muted">
              <span aria-hidden="true">
                {selected === item.key ? "▾" : "▸"}
              </span>
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
              <span className="min-w-0 wrap-break-word">
                {item.name || t("pages.import.review.unnamedItem")}
              </span>
              {item.match &&
                !item.match.selected &&
                (item.match.status === "NEW" || item.match.status === null) && (
                  <span className="shrink-0 rounded-lg bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                    {t("pages.import.review.match.NEW")}
                  </span>
                )}
            </span>
            <span className="text-right whitespace-nowrap tabular-nums">
              {money(item.totalPriceCents)}
            </span>
            <span className="col-start-2 col-end-4 text-xs text-muted">
              {item.quantity === null
                ? "—"
                : new Intl.NumberFormat(i18n.language).format(item.quantity)}
              {item.unit &&
                ` ${t(`pages.import.review.units.${item.unit}`, { defaultValue: item.unit })}`}
              {item.unitPriceCents !== null &&
                ` × ${money(item.unitPriceCents)}`}
              {item.lineType !== "product" &&
                ` · ${t(`pages.import.review.lineTypes.${item.lineType}`)}`}
              {issues.some(
                (issue) =>
                  issue.number === index + 1 && issue.code !== "discountAmount",
              ) && (
                <span className="ml-2 text-warning">
                  {t("pages.import.review.checkItem")}
                </span>
              )}
            </span>
          </button>
          {selected === item.key && (
            <div
              id={`${id}-${item.key}-editor`}
              role="region"
              aria-labelledby={`${id}-${item.key}-toggle`}
              className="mt-2 mb-3 border-l-2 border-accent/30 pl-3"
            >
              {editor}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
