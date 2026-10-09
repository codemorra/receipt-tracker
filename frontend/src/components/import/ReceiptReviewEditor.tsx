import { useRef, useState } from "react";
import {
  selectedItemId,
  selectionAfterRemoval,
  toggleItemSelection,
} from "../../review/item-selection";
import { reviewDraftToSummary } from "../../receipts/receipt-summary";
import ReviewItemList from "./ReviewItemList";
import { useTranslation } from "react-i18next";
import type { useReceiptReview } from "../../hooks/useReceiptReview";

import { useReviewLookup } from "../../hooks/useReviewLookup";
import ReceiptHeaderEditor from "./ReceiptHeaderEditor";
import ReviewItemEditor from "./ReviewItemEditor";
import ReviewDiscountsEditor from "./ReviewDiscountsEditor";

type ReviewController = ReturnType<typeof useReceiptReview>;

/**
 * Component for displaying feedback on the receipt review, including sum status and issues.
 * @param controller The review controller managing the receipt review state.
 */
export function ReceiptReviewFeedback({
  controller,
}: {
  controller: ReviewController;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p
        role="status"
        className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
          controller.sumStatus === "MATCH"
            ? "border-shell bg-canvas/30 text-muted"
            : controller.sumStatus === "MISMATCH"
              ? "border-warning/40 bg-warning-soft text-warning"
              : "border-accent/30 bg-accent-soft text-accent"
        }`}
      >
        {t(`pages.import.review.sum.${controller.sumStatus}`)}
      </p>
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
    </div>
  );
}

/**
 * Full editor for reviewing and editing receipt details, including items and discounts.
 * @param controller The review controller managing the receipt review state.
 * @param active Boolean indicating if the editor is currently active.
 */
export default function ReceiptReviewEditor({
  controller,
  active,
}: {
  controller: ReviewController;
  active: boolean;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [focusTarget, setFocusTarget] = useState<{
    id: string;
    field: "name" | "heading";
  } | null>(null);
  const selected = selectedItemId(controller.draft.items, selection);
  const index = controller.draft.items.findIndex(
    (item) => item.id === selected,
  );
  const item = controller.draft.items[index];
  function addItem() {
    const id = controller.addItem();
    setSelection(id);
    setFocusTarget({ id, field: "name" });
  }
  function removeItem(id: string) {
    const next = selectionAfterRemoval(controller.draft.items, selected, id);
    setSelection(next);
    setFocusTarget(next ? { id: next, field: "heading" } : null);
    controller.removeItem(id);
    if (!next) addButton.current?.focus();
  }
  const categories = useReviewLookup(
    "categories",
    "",
    active,
    controller.reportError,
  );
  return (
    <div className="space-y-6">
      <ReceiptHeaderEditor controller={controller} />
      <ReceiptReviewFeedback controller={controller} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t("pages.import.review.items")}
          </h3>
          <button
            ref={addButton}
            type="button"
            onClick={addItem}
            className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
          >
            {t("pages.import.review.addItem")}
          </button>
        </div>
        {controller.draft.items.length > 0 ? (
          <ReviewItemList
            receipt={reviewDraftToSummary(controller.draft)}
            selected={selected}
            issues={controller.issues}
            editor={
              item ? (
                <ReviewItemEditor
                  key={item.id}
                  item={item}
                  index={index}
                  categories={categories.options}
                  controller={controller}
                  onRemove={removeItem}
                  focusName={
                    focusTarget?.id === item.id && focusTarget.field === "name"
                  }
                  focusHeading={
                    focusTarget?.id === item.id &&
                    focusTarget.field === "heading"
                  }
                />
              ) : null
            }
            onSelect={(id) => {
              setSelection((current) => toggleItemSelection(current, id));
              setFocusTarget(null);
            }}
          />
        ) : (
          <p className="text-sm text-muted">
            {t("pages.import.review.noItems")}
          </p>
        )}
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
  );
}
