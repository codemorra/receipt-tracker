import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ReviewDto } from "../../review/review-state";
import { useReceiptReview } from "../../hooks/useReceiptReview";
import { useReviewLookup } from "../../hooks/useReviewLookup";
import Card from "../ui/Card";
import Toast from "../ui/Toast";
import { useReceiptConfirmation } from "../../hooks/useReceiptConfirmation";
import ReceiptDuplicateComparison from "./ReceiptDuplicateComparison";
import ReceiptHeaderEditor from "./ReceiptHeaderEditor";
import ReviewItemEditor from "./ReviewItemEditor";
import ReviewDiscountsEditor from "./ReviewDiscountsEditor";

/**
 * Renders the panel for reviewing a receipt, including the header, items, discounts, and any issues or warnings.
 * @param review - The review data transfer object containing the receipt and related information.
 */
export default function ReceiptReviewPanel({
  review,
  onSaved,
  onCancelled,
  onBusyChange,
}: {
  review: ReviewDto;
  onSaved: (id: number) => void;
  onCancelled: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const controller = useReceiptReview(review);
  const confirmation = useReceiptConfirmation(
    review,
    controller.draft,
    onSaved,
    onCancelled,
  );
  useEffect(() => {
    onBusyChange(confirmation.busy !== null);
    return () => onBusyChange(false);
  }, [confirmation.busy, onBusyChange]);
  const categories = useReviewLookup(
    "categories",
    "",
    true,
    controller.reportError,
  );
  const duplicateCount = confirmation.candidates.length;
  return (
    <Card
      aria-labelledby="import-review-heading"
      className="min-w-0 space-y-6 p-5 sm:p-6"
    >
      {(confirmation.notice || controller.notice) && (
        <Toast
          key={
            confirmation.notice
              ? `save-${confirmation.notice.id}`
              : `review-${controller.notice!.id}`
          }
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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="import-review-heading" className="text-lg font-semibold">
          {t("pages.import.review.title")}
        </h2>
        <span className="rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent">
          {t("pages.import.review.itemCount", {
            count: controller.draft.items.length,
          })}
        </span>
      </header>
      <div inert={confirmation.busy !== null} className="space-y-6">
        <ReceiptHeaderEditor controller={controller} />
        <p
          role="status"
          className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
            controller.sumStatus === "MATCH"
              ? "border-shell bg-canvas/30 text-muted"
              : controller.sumStatus === "MISMATCH"
                ? "border-red-500/40 bg-red-500/10 text-red-700 in-data-[theme=dark]:text-red-300"
                : "border-accent/30 bg-accent-soft text-accent"
          }`}
        >
          {t(`pages.import.review.sum.${controller.sumStatus}`)}
        </p>
        {(duplicateCount > 0 ||
          review.warnings.includes("possible_duplicate")) && (
          <p
            role="status"
            className="rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5 text-xs leading-relaxed text-accent"
          >
            {t("pages.import.review.possibleDuplicate")}
          </p>
        )}
        <hr className="border-shell" />
        {controller.issues.length > 0 && (
          <details className="rounded-xl border border-accent/25 px-3 py-2.5">
            <summary className="cursor-pointer text-xs font-medium text-accent">
              {t("pages.import.review.issuesHeading", {
                count: controller.issues.length,
              })}
            </summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted">
              {controller.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.number ?? 0}-${index}`}>
                  {t(`pages.import.review.issues.${issue.code}`, {
                    number: issue.number,
                  })}
                </li>
              ))}
            </ul>
          </details>
        )}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t("pages.import.review.items")}
            </h3>
            <button
              type="button"
              onClick={controller.addItem}
              className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
            >
              {t("pages.import.review.addItem")}
            </button>
          </div>
          {controller.draft.items.map((item, index) => (
            <ReviewItemEditor
              key={item.id}
              item={item}
              index={index}
              categories={categories.options}
              controller={controller}
            />
          ))}
        </section>
        <hr className="border-shell" />
        <ReviewDiscountsEditor controller={controller} />
        <hr className="border-shell" />
        {categories.failed && (
          <button
            type="button"
            onClick={categories.retry}
            className="rounded text-xs text-accent underline underline-offset-4"
          >
            {t("pages.import.review.retryCategories")}
          </button>
        )}
      </div>
      {duplicateCount > 0 && (
        <ReceiptDuplicateComparison
          archiveUrl={review.archiveUrl}
          draft={controller.draft}
          candidates={confirmation.candidates}
        />
      )}
      <div
        className={`flex flex-wrap justify-end gap-3 ${duplicateCount > 0 ? "border-t border-shell pt-5" : ""}`}
        aria-busy={confirmation.busy !== null}
      >
        {duplicateCount > 0 && (
          <button
            type="button"
            disabled={confirmation.busy !== null}
            onClick={() => void confirmation.cancel()}
            className="cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm text-muted hover:bg-surface-hover disabled:cursor-default disabled:opacity-50"
          >
            {t(
              confirmation.busy === "cancel"
                ? "pages.import.save.cancelling"
                : "pages.import.save.cancelImport",
            )}
          </button>
        )}
        <button
          type="button"
          disabled={confirmation.busy !== null || controller.issues.length > 0}
          onClick={() => void confirmation.save(duplicateCount > 0)}
          className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover disabled:cursor-default disabled:opacity-50"
        >
          {t(
            confirmation.busy === "save"
              ? "pages.import.save.saving"
              : duplicateCount > 0
                ? "pages.import.save.override"
                : "pages.import.save.save",
          )}
        </button>
      </div>
    </Card>
  );
}
