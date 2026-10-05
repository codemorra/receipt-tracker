import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  warrantyDateIssue,
  type ItemDraft,
  type WarrantyDraft,
  type WarrantyType,
} from "../../review/review-state";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import { SelectField, TextField, TextAreaField } from "../ui/FormField";

// Constants and helper functions for the ItemWarrantyEditor component.
const warrantyTypes: WarrantyType[] = ["statutory", "manufacturer", "extended"];
type WarrantyValues = Omit<WarrantyDraft, "id">;
const emptyPending = () => ({
  type: "statutory" as WarrantyType,
  startDate: null as string | null,
  endDate: "",
  notes: "",
});

/**
 * Renders the fields for editing a warranty.
 * @param warranty - The current warranty values.
 * @param onChange - Callback to handle changes to the warranty fields.
 * @param showIssue - Whether to display validation issues for the warranty dates.
 */
function WarrantyFields({
  warranty,
  onChange,
  showIssue,
}: {
  warranty: WarrantyValues;
  onChange: (changes: Partial<WarrantyValues>) => void;
  showIssue: boolean;
}) {
  const { t } = useTranslation();
  const issue = showIssue ? warrantyDateIssue(warranty) : null;
  return (
    <div className="space-y-3 rounded-xl border border-shell bg-canvas/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <SelectField
            label={t("pages.import.review.warrantyType")}
            value={warranty.type}
            options={warrantyTypes.map((type) => ({
              value: type,
              label: t(`pages.import.review.warrantyTypes.${type}`),
            }))}
            onChange={(value) => onChange({ type: value as WarrantyType })}
          />
        </div>
        <TextField
          label={t("pages.import.review.startDate")}
          type="date"
          value={warranty.startDate}
          onChange={(event) => onChange({ startDate: event.target.value })}
        />
        <TextField
          label={t("pages.import.review.endDate")}
          type="date"
          value={warranty.endDate}
          onChange={(event) => onChange({ endDate: event.target.value })}
        />
      </div>
      <TextAreaField
        label={t("pages.import.review.notes")}
        rows={2}
        value={warranty.notes}
        onChange={(event) => onChange({ notes: event.target.value })}
      />
      {issue && (
        <p role="alert" className="text-xs text-accent">
          {t(`pages.import.review.warrantyIssues.${issue}`)}
        </p>
      )}
    </div>
  );
}

/**
 * Renders the editor for managing warranties of an item.
 * @param item - The item draft containing the warranties.
 * @param controller - The controller for handling receipt review actions.
 */
export default function ItemWarrantyEditor({
  item,
  controller,
}: {
  item: ItemDraft;
  controller: ReturnType<typeof useReceiptReview>;
}) {
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState(emptyPending);
  const [attempted, setAttempted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const values: WarrantyValues = {
    ...pending,
    startDate: pending.startDate ?? controller.draft.purchaseDate,
  };
  function reset() {
    setPending(emptyPending());
    setAttempted(false);
    setEditingId(null);
  }
  function save() {
    setAttempted(true);
    if (warrantyDateIssue(values)) return;
    if (editingId) controller.updateWarranty(item.id, editingId, values);
    else controller.addWarranty(item.id, values);
    reset();
  }
  const dateLabel = (value: string) => {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString(i18n.resolvedLanguage);
  };
  return (
    <details className="border-t border-shell pt-3">
      <summary className="cursor-pointer text-xs font-medium text-muted">
        {t("pages.import.review.warrantyCount", {
          count: item.warranties.length,
        })}
      </summary>
      <div className="mt-4 space-y-4">
        <WarrantyFields
          warranty={values}
          onChange={(changes) =>
            setPending((current) => ({ ...current, ...changes }))
          }
          showIssue={attempted}
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
          >
            {t(
              editingId
                ? "pages.import.review.saveWarranty"
                : "pages.import.review.addWarranty",
            )}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg px-3 py-2 text-xs text-muted hover:text-accent"
            >
              {t("pages.import.review.cancel")}
            </button>
          )}
        </div>
        {item.warranties.map((warranty) => (
          <div
            key={warranty.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-shell bg-canvas/30 p-3"
          >
            <div className="min-w-0 space-y-1 text-xs">
              <p className="font-medium">
                {t(`pages.import.review.warrantyTypes.${warranty.type}`)}
              </p>
              <p className="text-muted">
                {dateLabel(warranty.startDate)} – {dateLabel(warranty.endDate)}
              </p>
              {warranty.notes && (
                <p className="wrap-break-word whitespace-pre-wrap text-muted">
                  {warranty.notes}
                </p>
              )}
            </div>
            <div className="ml-auto flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setEditingId(warranty.id);
                  setPending({
                    type: warranty.type,
                    startDate: warranty.startDate,
                    endDate: warranty.endDate,
                    notes: warranty.notes,
                  });
                  setAttempted(false);
                }}
                className="cursor-pointer rounded text-xs text-accent hover:underline"
              >
                {t("pages.import.review.editWarranty")}
              </button>
              <button
                type="button"
                onClick={() => {
                  controller.removeWarranty(item.id, warranty.id);
                  if (editingId === warranty.id) reset();
                }}
                className="cursor-pointer rounded text-xs text-muted hover:text-accent"
              >
                {t("pages.import.review.removeWarranty")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
