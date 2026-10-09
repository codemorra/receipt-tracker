import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewDto } from "../../review/review-state";
import { reviewDraftToSummary } from "../../receipts/receipt-summary";
import { useReceiptReview } from "../../hooks/useReceiptReview";
import { useReceiptConfirmation } from "../../hooks/useReceiptConfirmation";
import ReceiptSummary from "../receipts/ReceiptSummary";
import Modal from "../ui/Modal";
import Toast from "../ui/Toast";
import ReceiptDuplicateComparison from "./ReceiptDuplicateComparison";
import ReceiptReviewEditor, {
  ReceiptReviewFeedback,
} from "./ReceiptReviewEditor";
import ReceiptArchiveImage from "../receipts/ReceiptArchiveImage";

/**
 * Panel component for reviewing a receipt, including summary, feedback, and duplicate handling.
 * @param review The review data transfer object containing the receipt and its review state.
 * @param onSaved Callback invoked when the receipt review is successfully saved.
 * @param onDiscard Callback invoked when the review process is cancelled.
 * @param onBusyChange Callback invoked when the busy state changes.
 * @param onDraftChange Callback invoked when the draft changes, indicating whether there are unsaved changes.
 * @param locked Indicates whether the review panel is locked and should be non-interactive.
 */
export default function ReceiptReviewPanel({
  review,
  onSaved,
  onDiscard,
  onBusyChange,
  onDraftChange,
  locked = false,
}: {
  review: ReviewDto;
  onSaved: (id: number) => void;
  onDiscard: () => void;
  locked?: boolean;
  onBusyChange: (busy: boolean) => void;
  onDraftChange: (changed: boolean) => void;
}) {
  const { t } = useTranslation();
  const controller = useReceiptReview(review);
  useLayoutEffect(() => {
    onDraftChange(controller.changed);
  }, [controller.changed, onDraftChange]);
  useLayoutEffect(() => () => onDraftChange(false), [onDraftChange]);
  const confirmation = useReceiptConfirmation(
    review,
    controller.draft,
    onSaved,
    onBusyChange,
    (candidates) =>
      controller.updateReceipt({
        merchantCandidates: candidates,
        merchantMatchStatus: "SUGGESTED",
      }),
  );
  const [modal, setModal] = useState<"advanced" | "duplicates" | null>(null);
  const busy = confirmation.busy !== null || locked;
  const invalid = controller.issues.length > 0;
  const duplicateCount = confirmation.candidates.length;
  async function save() {
    const result = await confirmation.save();
    if (result === "duplicates") setModal("duplicates");
    if (result === "merchant_selection_required") setModal("advanced");
  }
  const secondary =
    "cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
  const primary =
    "cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover disabled:cursor-default disabled:opacity-50";
  return (
    <section
      aria-label={t("pages.import.review.title")}
      className="min-w-0 space-y-4"
      inert={locked}
    >
      {(confirmation.notice || controller.notice) && (
        <Toast
          key={`${modal ?? "summary"}-${confirmation.notice ? `save-${confirmation.notice.id}` : `review-${controller.notice!.id}`}`}
          tone="error"
          message={
            confirmation.notice
              ? t(`pages.import.save.errors.${confirmation.notice.code}`)
              : t(`pages.import.review.errors.${controller.notice!.code}`)
          }
          onDismiss={
            confirmation.notice
              ? confirmation.dismissNotice
              : controller.dismissNotice
          }
        />
      )}
      <ReceiptSummary
        receipt={reviewDraftToSummary(controller.draft)}
        status={t("pages.import.review.itemCount", {
          count: controller.draft.items.length,
        })}
      />
      <ReceiptReviewFeedback controller={controller} />
      {invalid && (
        <p className="text-xs leading-relaxed text-muted">
          {t("pages.import.review.correctionsRequired")}
        </p>
      )}
      {duplicateCount > 0 && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
            confirmation.duplicatesConfirmed
              ? "border-success/40 bg-success-soft text-success"
              : "border-warning/40 bg-warning-soft text-warning"
          }`}
        >
          <p
            role="status"
            className="min-w-0 text-xs leading-relaxed whitespace-pre-line"
          >
            {t(
              confirmation.duplicatesConfirmed
                ? "pages.import.duplicates.confirmed"
                : "pages.import.review.possibleDuplicate",
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            className={`${secondary} ml-auto shrink-0`}
            onClick={() => setModal("duplicates")}
          >
            {t("pages.import.duplicates.review")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-3" aria-busy={busy}>
        <button
          type="button"
          disabled={busy}
          className={secondary}
          onClick={() => setModal("advanced")}
        >
          {t("pages.import.advanced.title")}
        </button>
        <button
          type="button"
          disabled={
            busy ||
            invalid ||
            (duplicateCount > 0 && !confirmation.duplicatesConfirmed)
          }
          className={primary}
          onClick={() => void save()}
        >
          {t(
            confirmation.busy === "save"
              ? "pages.import.save.saving"
              : "pages.import.save.save",
          )}
        </button>
      </div>
      <Modal
        open={modal === "advanced"}
        placement="right"
        scrollContent={false}
        title={t("pages.import.advanced.title")}
        size="wide"
        busy={busy}
        onClose={() => setModal(null)}
      >
        <div
          className="mt-5 grid min-h-0 flex-1 grid-cols-1 gap-6 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:grid-rows-1 lg:overflow-hidden"
          inert={busy}
        >
          <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
            <ReceiptArchiveImage
              url={review.archiveUrl}
              alt={t("pages.import.scan.archiveAlt")}
              className="h-auto"
            />
          </div>
          <div className="@container min-w-0 space-y-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-3 lg:scrollbar-gutter-stable">
            <p className="text-sm leading-relaxed text-muted">
              {t("pages.import.advanced.hint")}
            </p>
            <ReceiptReviewEditor
              controller={controller}
              active={modal === "advanced"}
            />
          </div>
        </div>
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-3 border-t border-shell pt-4">
          <button
            type="button"
            disabled={busy}
            className={primary}
            onClick={() => setModal(null)}
          >
            {t("pages.import.advanced.done")}
          </button>
        </div>
      </Modal>
      <Modal
        open={modal === "duplicates"}
        placement="right"
        scrollContent={false}
        title={t("pages.import.duplicates.title")}
        size="wide"
        busy={busy}
        onClose={() => setModal(null)}
      >
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5">
          <ReceiptDuplicateComparison
            archiveUrl={review.archiveUrl}
            draft={controller.draft}
            candidates={confirmation.candidates}
          />
          {invalid && (
            <p className="shrink-0 text-xs text-muted">
              {t("pages.import.review.correctionsRequired")}
            </p>
          )}
          <div
            className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-shell pt-5"
            aria-busy={busy}
          >
            <button
              type="button"
              disabled={busy}
              className={secondary}
              onClick={onDiscard}
            >
              {t("pages.import.discard.action")}
            </button>
            <button
              type="button"
              disabled={busy || duplicateCount === 0}
              className={primary}
              onClick={() => {
                confirmation.confirmDuplicates();
                setModal(null);
              }}
            >
              {t("pages.import.save.override")}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
