import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import { SelectField, TextField } from "../ui/FormField";
import InlineConfirmation from "../ui/InlineConfirmation";

/**
 * Renders the editor for managing discounts on a receipt, allowing the user to add, edit, and remove discounts.
 * @param controller - The controller for handling receipt review actions.
 */
export default function ReviewDiscountsEditor({
  controller,
}: {
  controller: ReturnType<typeof useReceiptReview>;
}) {
  const { t } = useTranslation();
  const { draft } = controller;
  const [expanded, setExpanded] = useState(false);
  const invalid = controller.issues.some(
    (issue) => issue.code === "discountAmount",
  );
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removalTarget = draft.discounts.find(
    (discount) => discount.id === removingId,
  );
  return (
    <section className="space-y-3">
      {removalTarget && (
        <InlineConfirmation
          title={t("pages.import.review.removeDiscount")}
          message={t("pages.import.review.removeDiscountConfirmation", {
            name:
              removalTarget.description ||
              removalTarget.rawName ||
              t("pages.import.review.discounts"),
          })}
          confirmLabel={t("pages.import.review.confirmRemoval")}
          cancelLabel={t("pages.import.review.cancel")}
          onCancel={() => setRemovingId(null)}
          onConfirm={() => {
            controller.removeDiscount(removalTarget.id);
            setRemovingId(null);
          }}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t("pages.import.review.discounts")}
        </h3>
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            controller.addDiscount();
          }}
          className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
        >
          {t("pages.import.review.addDiscount")}
        </button>
      </div>
      {draft.discounts.length > 0 && (
        <details
          open={expanded || invalid}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
          className="space-y-3"
        >
          <summary
            onClick={(event) => {
              if (invalid) event.preventDefault();
            }}
            className="cursor-pointer text-sm text-muted hover:text-accent"
          >
            {t("pages.import.review.discounts")} ({draft.discounts.length})
          </summary>
          {draft.discounts.map((discount, index) => (
            <article
              key={discount.id}
              className="space-y-3 rounded-xl border border-shell bg-canvas/25 p-3 @min-[30rem]:p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-muted">
                  {t("pages.import.review.discountNumber", {
                    number: index + 1,
                  })}
                </h4>
                <button
                  type="button"
                  onClick={() => setRemovingId(discount.id)}
                  aria-label={t("pages.import.review.removeDiscount")}
                  title={t("pages.import.review.removeDiscount")}
                  className="cursor-pointer rounded p-1 text-muted hover:text-accent"
                >
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <path d="M4 7h16M10 3h4M6 7l1 14h10l1-14M10 10v7m4-7v7" />
                  </svg>
                </button>
              </div>
              <div className="grid gap-3 @min-[30rem]:grid-cols-2">
                <TextField
                  label={t("pages.import.review.discountDescription")}
                  value={discount.description}
                  onChange={(event) =>
                    controller.updateDiscount(discount.id, {
                      description: event.target.value,
                    })
                  }
                />
                <TextField
                  label={t("pages.import.review.discountAmount")}
                  inputMode="decimal"
                  value={discount.amount}
                  onChange={(event) =>
                    controller.updateDiscount(discount.id, {
                      amount: event.target.value,
                    })
                  }
                />
                <TextField
                  label={t("pages.import.review.discountRawName")}
                  value={discount.rawName}
                  onChange={(event) =>
                    controller.updateDiscount(discount.id, {
                      rawName: event.target.value,
                    })
                  }
                />
                <SelectField
                  label={t("pages.import.review.appliesTo")}
                  value={
                    discount.appliesToItemIndex === null
                      ? ""
                      : String(discount.appliesToItemIndex)
                  }
                  options={[
                    { value: "", label: t("pages.import.review.wholeReceipt") },
                    ...draft.items.map((item, index) => ({
                      value: String(index),
                      label: `${t("pages.import.review.itemNumber", { number: index + 1 })} · ${item.selectedProductName ?? (item.normalizedName || item.rawName)}`,
                    })),
                  ]}
                  onChange={(value) =>
                    controller.updateDiscount(discount.id, {
                      appliesToItemIndex: value === "" ? null : Number(value),
                    })
                  }
                />
              </div>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}
