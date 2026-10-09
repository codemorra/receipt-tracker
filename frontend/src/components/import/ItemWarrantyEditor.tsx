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
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = item.warranties.find((entry) => entry.id === editingId);

  // Function to add a new warranty entry for the item.
  function add() {
    const id = controller.addWarranty(item.id, {
      type: "statutory",
      startDate: controller.draft.purchaseDate,
      endDate: "",
      notes: "",
    });
    setEditingId(id);
  }
  const dateLabel = (value: string) => {
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString(i18n.resolvedLanguage);
  };
  return (
    <section className="space-y-3 border-t border-shell pt-4">
      <h5 className="text-sm font-semibold">
        {t("pages.import.review.warrantyHeading")}
      </h5>
      {item.warranties.length === 0 && (
        <p className="text-xs text-muted">
          {t("pages.import.review.noWarranty")}
        </p>
      )}
      {item.warranties.map((warranty) => {
        const open =
          editing?.id === warranty.id || warrantyDateIssue(warranty) !== null;
        return (
          <div
            key={warranty.id}
            className="space-y-3 rounded-xl border border-shell p-3"
          >
            {open ? (
              <WarrantyFields
                warranty={warranty}
                onChange={(changes) => {
                  setEditingId(warranty.id);
                  controller.updateWarranty(item.id, warranty.id, changes);
                }}
                showIssue
              />
            ) : (
              <div className="space-y-1 text-xs">
                <p className="font-medium">
                  {t(`pages.import.review.warrantyTypes.${warranty.type}`)}
                </p>
                <p className="text-muted">
                  {dateLabel(warranty.startDate)} –{" "}
                  {dateLabel(warranty.endDate)}
                </p>
                {warranty.notes && (
                  <p className="wrap-break-word whitespace-pre-wrap text-muted">
                    {warranty.notes}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={open && warrantyDateIssue(warranty) !== null}
                onClick={() => setEditingId(open ? null : warranty.id)}
                className="rounded text-xs text-accent hover:underline disabled:opacity-50"
              >
                {t(
                  open
                    ? "pages.import.review.finishWarranty"
                    : "pages.import.review.editWarranty",
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  controller.removeWarranty(item.id, warranty.id);
                  if (editingId === warranty.id) setEditingId(null);
                }}
                className="rounded text-xs text-muted hover:text-accent"
              >
                {t("pages.import.review.removeWarranty")}
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
      >
        {t("pages.import.review.addWarranty")}
      </button>
    </section>
  );
}
