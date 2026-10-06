import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";
import {
  parseCents,
  type DuplicateCandidate,
  type ReviewDraft,
} from "../../review/review-state";
import ReceiptArchiveImage from "../receipts/ReceiptArchiveImage";
import Select from "../ui/Select";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
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
  const selectedPanel =
    panels.slice(1).find((panel) => panel.key === selectedId) ?? panels[1];
  const renderPanel = (panel: (typeof panels)[number]) => (
    <div
      key={panel.key}
      className="min-w-0 space-y-3 rounded-xl border border-shell bg-surface/70 p-3"
    >
      <h4 className="text-xs font-semibold">{panel.title}</h4>
      <div className="space-y-1 text-xs">
        <p className="font-medium wrap-break-word">{panel.merchant}</p>
        <p className="text-muted">
          {panel.date} {panel.time ?? ""}
        </p>
        <p className="font-semibold">{money(panel.total, panel.currency)}</p>
      </div>
      <ul className="space-y-2 text-xs">
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
      <hr className="border-0 border-t border-shell" />
      <ReceiptArchiveImage
        url={panel.url}
        alt={panel.title}
        className="h-auto"
      />
    </div>
  );
  return (
    <section
      aria-label={t("pages.import.duplicates.title")}
      className="flex min-h-0 flex-1 flex-col gap-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-4"
    >
      <div className="shrink-0">
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {t("pages.import.duplicates.hint")}
        </p>
      </div>
      {candidates.length > 1 && selectedPanel && (
        <div className="shrink-0 overflow-y-auto pr-3 scrollbar-gutter-stable">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-start-2">
              <Select
                label={t("pages.import.duplicates.chooseReceipt")}
                value={selectedPanel.key}
                options={panels
                  .slice(1)
                  .map((panel) => ({ value: panel.key, label: panel.title }))}
                compact
                floatingPanel
                onChange={(value) => {
                  setSelectedId(value);
                  scrollArea.current?.scrollTo({ top: 0 });
                }}
              />
            </div>
          </div>
        </div>
      )}
      <div
        ref={scrollArea}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-3 scrollbar-gutter-stable"
      >
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {renderPanel(panels[0])}
          {selectedPanel && renderPanel(selectedPanel)}
        </div>
      </div>
    </section>
  );
}
