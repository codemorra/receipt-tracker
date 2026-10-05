import { useTranslation } from "react-i18next";
import type { ReviewDto } from "../../review/review-state";
import { useReceiptReview } from "../../hooks/useReceiptReview";
import { useReviewLookup } from "../../hooks/useReviewLookup";
import Card from "../ui/Card";
import Toast from "../ui/Toast";
import ReceiptHeaderEditor from "./ReceiptHeaderEditor";
import ReviewItemEditor from "./ReviewItemEditor";
import ReviewDiscountsEditor from "./ReviewDiscountsEditor";

/**
 * Renders the panel for reviewing a receipt, including the header, items, discounts, and any issues or warnings.
 * @param review - The review data transfer object containing the receipt and related information.
 */
export default function ReceiptReviewPanel({ review }: { review: ReviewDto }) {
  const { t } = useTranslation();
  const controller = useReceiptReview(review);
  const categories = useReviewLookup(
    "categories",
    "",
    true,
    controller.reportError,
  );
  const duplicateCount = review.duplicateCandidates?.length ?? 0;
  return (
    <Card
      aria-labelledby="import-review-heading"
      className="min-w-0 space-y-6 p-5 sm:p-6"
    >
      {controller.notice && (
        <Toast
          key={controller.notice.id}
          tone="error"
          message={t(`pages.import.review.errors.${controller.notice.code}`)}
          onDismiss={controller.dismissNotice}
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
      <ReviewDiscountsEditor controller={controller} />
      {categories.failed && (
        <button
          type="button"
          onClick={categories.retry}
          className="rounded text-xs text-accent underline underline-offset-4"
        >
          {t("pages.import.review.retryCategories")}
        </button>
      )}
      <p className="border-t border-shell pt-4 text-xs leading-relaxed text-muted">
        {t("pages.import.review.saveTransition")}
      </p>
    </Card>
  );
}
