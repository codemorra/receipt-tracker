import { useTranslation } from "react-i18next";
import {
  parseCents,
  type DuplicateCandidate,
  type ReviewDraft,
} from "../../review/review-state";
import ReceiptArchiveImage from "../receipts/ReceiptArchiveImage";

/**
 * Component for comparing a receipt with its potential duplicate candidates.
 * @param archiveUrl - The URL of the receipt archive image.
 * @param draft - The current review draft of the receipt.
 * @param candidates - The list of potential duplicate candidates.
 * @returns A React element representing the comparison of the receipt with its duplicate candidates.
 */
export default function ReceiptDuplicateComparison({
  archiveUrl,
  draft,
  candidates,
}: {
  archiveUrl: string;
  draft: ReviewDraft;
  candidates: DuplicateCandidate[];
}) {
  const { t, i18n } = useTranslation();
  const money = (cents: number | null, currency: string) =>
    cents === null
      ? "—"
      : /^[A-Z]{3}$/.test(currency)
        ? new Intl.NumberFormat(i18n.language, {
            style: "currency",
            currency,
          }).format(cents / 100)
        : `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} ${currency}`.trim();
  const panels = [
    {
      key: "current",
      title: t("pages.import.duplicates.current"),
      url: archiveUrl,
      merchant: draft.merchantName,
      date: draft.purchaseDate,
      time: draft.purchaseTime,
      total: parseCents(draft.total),
      currency: draft.currency,
      items: draft.items.map((item) => ({
        key: item.id,
        name: item.rawName,
        quantity: item.quantity,
        total: parseCents(item.totalPrice),
      })),
    },
    ...candidates.map((candidate) => ({
      key: String(candidate.receiptId),
      title: t("pages.import.duplicates.existing", { id: candidate.receiptId }),
      url: `/api/receipts/${candidate.receiptId}/image`,
      merchant: candidate.merchantName,
      date: candidate.purchaseDate,
      time: candidate.purchaseTime,
      total: candidate.totalCents,
      currency: candidate.currency,
      items: candidate.items.map((item) => ({
        key: String(item.position),
        name: item.rawName,
        quantity: String(item.quantity),
        total: item.totalPriceCents,
      })),
    })),
  ];
  const renderPanel = (panel: (typeof panels)[number]) => (
    <div
      key={panel.key}
      className="min-w-0 space-y-3 rounded-xl border border-shell bg-surface/70 p-3"
    >
      <h4 className="text-xs font-semibold">{panel.title}</h4>
      <ReceiptArchiveImage
        url={panel.url}
        alt={panel.title}
        className="max-h-64"
      />
      <div className="space-y-1 text-xs">
        <p className="font-medium wrap-break-word">{panel.merchant}</p>
        <p className="text-muted">
          {panel.date} {panel.time ?? ""}
        </p>
        <p className="font-semibold">{money(panel.total, panel.currency)}</p>
      </div>
      <ul className="max-h-48 space-y-2 overflow-y-auto text-xs">
        {panel.items.map((item) => (
          <li key={item.key} className="flex justify-between gap-2">
            <span className="min-w-0 wrap-break-word">
              {item.name} · {item.quantity}
            </span>
            <span className="shrink-0">
              {money(item.total, panel.currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section
      aria-label={t("pages.import.duplicates.title")}
      className="space-y-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold">
          {t("pages.import.duplicates.title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t("pages.import.duplicates.hint")}
        </p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        {renderPanel(panels[0])}
        <div className="min-w-0 space-y-4">
          {panels.slice(1).map(renderPanel)}
        </div>
      </div>
    </section>
  );
}
