import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LookupOption } from "../../api/review-api";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import type { ItemDraft, LineType, Unit } from "../../review/review-state";
import { SelectField, TextField } from "../ui/FormField";
import InlineConfirmation from "../ui/InlineConfirmation";
import ProductAssignment from "./ProductAssignment";
import ItemWarrantyEditor from "./ItemWarrantyEditor";

const units: Unit[] = ["pcs", "g", "kg", "ml", "l"];
const lineTypes: LineType[] = ["product", "deposit", "fee", "other"];

/**
 * Renders the editor for a single item on a receipt, allowing the user to edit
 * product details, quantity, unit, and other relevant information.
 * @param item - The item draft to be edited.
 * @param index - The index of the item in the receipt.
 * @param categories - The list of available categories for the item.
 * @param controller - The controller for handling receipt review actions.
 * @param onRemove - Callback invoked when the item is removed from the receipt.
 * @param focusName - Indicates whether the name field should be focused initially.
 * @param focusHeading - Indicates whether the heading should be focused initially.
 */
export default function ReviewItemEditor({
  item,
  index,
  categories,
  controller,
  onRemove,
  focusName = false,
  focusHeading = false,
}: {
  item: ItemDraft;
  index: number;
  categories: LookupOption[];
  controller: ReturnType<typeof useReceiptReview>;
  onRemove: (id: string) => void;
  focusName?: boolean;
  focusHeading?: boolean;
}) {
  const { t } = useTranslation();
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusName) name.current?.focus();
    else if (focusHeading) heading.current?.focus();
  }, [focusName, focusHeading]);
  const product = item.lineType === "product";
  const unitOptions = [
    { value: "", label: t("pages.import.review.noUnit") },
    ...units.map((unit) => ({
      value: unit,
      label: t(`pages.import.review.units.${unit}`),
    })),
  ];
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-shell bg-canvas/25 p-4">
      <h4 tabIndex={-1} ref={heading} className="text-sm font-semibold">
        {t("pages.import.review.itemNumber", { number: index + 1 })}
      </h4>
      <h5 className="text-xs font-semibold text-muted">
        {t("pages.import.review.basicData")}
      </h5>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
        <TextField
          ref={name}
          label={t(
            product
              ? "pages.import.review.productName"
              : "pages.import.review.rawName",
          )}
          value={
            product
              ? (item.selectedProductName ?? item.normalizedName)
              : item.rawName
          }
          onChange={(event) =>
            controller.updateItem(
              item.id,
              product
                ? {
                    normalizedName: event.target.value,
                    productId: null,
                    selectedProductName: null,
                    selectedProductDetails: null,
                    matchStatus: null,
                  }
                : { rawName: event.target.value },
            )
          }
        />
        {product && item.productId !== null && (
          <p className="text-xs text-muted sm:col-span-2 sm:row-start-2">
            {t("pages.import.review.renameUnlinks")}
          </p>
        )}
        <SelectField
          label={t("pages.import.review.lineType")}
          value={item.lineType}
          options={lineTypes.map((type) => ({
            value: type,
            label: t(`pages.import.review.lineTypes.${type}`),
          }))}
          onChange={(value) =>
            controller.setLineType(item.id, value as LineType)
          }
        />
      </div>
      <h5 className="text-xs font-semibold text-muted">
        {t("pages.import.review.quantityAndPrice")}
      </h5>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TextField
          label={t("pages.import.review.quantity")}
          inputMode="decimal"
          value={item.quantity}
          onChange={(event) =>
            controller.updateItem(item.id, { quantity: event.target.value })
          }
        />
        <SelectField
          label={t("pages.import.review.unit")}
          value={item.unit}
          options={unitOptions}
          onChange={(value) =>
            controller.updateItem(item.id, { unit: value as Unit | "" })
          }
        />
        <TextField
          label={t("pages.import.review.unitPrice")}
          inputMode="decimal"
          value={item.unitPrice}
          onChange={(event) =>
            controller.updateItem(item.id, { unitPrice: event.target.value })
          }
        />
        <TextField
          label={t("pages.import.review.itemTotal")}
          inputMode="decimal"
          value={item.totalPrice}
          onChange={(event) =>
            controller.updateItem(item.id, { totalPrice: event.target.value })
          }
        />
      </div>
      {product && (
        <ProductAssignment
          item={item}
          categories={categories}
          controller={controller}
        />
      )}
      {product && <ItemWarrantyEditor item={item} controller={controller} />}
      <div className="border-t border-shell pt-4">
        {confirmRemoval ? (
          <InlineConfirmation
            title={t("pages.import.review.removeItem", { number: index + 1 })}
            message={t("pages.import.review.removeItemConfirmation", {
              name:
                item.selectedProductName || item.normalizedName || item.rawName,
            })}
            confirmLabel={t("pages.import.review.confirmRemoval")}
            cancelLabel={t("pages.import.review.cancel")}
            onCancel={() => setConfirmRemoval(false)}
            onConfirm={() => onRemove(item.id)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemoval(true)}
            aria-label={t("pages.import.review.removeItem", {
              number: index + 1,
            })}
            className="rounded px-1 py-2 text-xs text-muted hover:text-accent"
          >
            {t("pages.import.review.deletePosition")}
          </button>
        )}
      </div>
    </article>
  );
}
