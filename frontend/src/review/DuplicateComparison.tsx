import { useTranslation } from "react-i18next";
import {
  parseCents,
  type DuplicateCandidate,
  type ReviewDraft,
} from "./review-state";

// Component for displaying duplicate comparison between the current scan and existing receipts.
interface Props {
  archiveUrl: string;
  draft: ReviewDraft;
  candidates: DuplicateCandidate[];
  busy: boolean;
  canImport: boolean;
  onCancel: () => void;
  onImport: () => void;
}

// Props for the DuplicateComparison component.
function DuplicateComparison({
  archiveUrl,
  draft,
  candidates,
  busy,
  canImport,
  onCancel,
  onImport,
}: Props) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (cents: number | null, currency: string) =>
    cents === null ? "—" : `${number.format(cents / 100)} ${currency}`;

  return (
    <section
      aria-labelledby="duplicate-heading"
      className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
    >
      <h3
        id="duplicate-heading"
        className="text-lg font-semibold text-amber-950"
      >
        {t("review.duplicateHeading")}
      </h3>
      <p className="text-sm text-amber-900">{t("review.duplicateHint")}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="space-y-2 rounded-lg bg-white p-4">
          <h4 className="font-semibold">{t("review.currentScan")}</h4>
          <img
            src={archiveUrl}
            alt={t("review.currentScanImage")}
            className="max-h-64 w-full object-contain"
          />
          <p>{draft.merchantName}</p>
          <p>
            {draft.purchaseDate} {draft.purchaseTime}
          </p>
          <p>{money(parseCents(draft.total), draft.currency)}</p>
          <ul className="list-inside list-disc text-sm">
            {draft.items.map((item) => (
              <li key={item.id}>
                {item.rawName} · {item.quantity} ·{" "}
                {money(parseCents(item.totalPrice), draft.currency)}
              </li>
            ))}
          </ul>
        </article>
        <div className="space-y-4">
          {candidates.map((candidate) => (
            <article
              key={candidate.receiptId}
              className="space-y-2 rounded-lg bg-white p-4"
            >
              <h4 className="font-semibold">
                {t("review.existingReceipt", { id: candidate.receiptId })}
              </h4>
              <img
                src={`/api/receipts/${candidate.receiptId}/image`}
                alt={t("review.existingReceiptImage", {
                  id: candidate.receiptId,
                })}
                className="max-h-64 w-full object-contain"
              />
              <p>{candidate.merchantName}</p>
              <p>
                {candidate.purchaseDate} {candidate.purchaseTime ?? ""}
              </p>
              <p>{money(candidate.totalCents, candidate.currency)}</p>
              <ul className="list-inside list-disc text-sm">
                {candidate.items.map((item) => (
                  <li key={item.position}>
                    {item.rawName} · {item.quantity} ·{" "}
                    {money(item.totalPriceCents, candidate.currency)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-amber-800 px-4 py-2 font-semibold text-amber-950 disabled:opacity-50"
        >
          {t("review.cancelImport")}
        </button>
        <button
          type="button"
          disabled={busy || !canImport}
          onClick={onImport}
          className="rounded-lg bg-amber-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {t("review.importAnyway")}
        </button>
      </div>
    </section>
  );
}

export default DuplicateComparison;
