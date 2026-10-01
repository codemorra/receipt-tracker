import { useTranslation } from "react-i18next";
import type { DiscountDraft, ItemDraft } from "./review-state";

// Props for the DiscountEditor component.
interface Props {
  discounts: DiscountDraft[];
  items: ItemDraft[];
  updateDiscount: (id: string, changes: Partial<DiscountDraft>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

// Component for editing the discounts applied to a receipt.
function DiscountEditor({
  discounts,
  items,
  updateDiscount,
  onAdd,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
  const labelClass = "block space-y-1 text-sm font-medium";

  return (
    <section aria-labelledby="discounts-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="discounts-heading" className="text-lg font-semibold">
          {t("review.discounts")}
        </h3>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
        >
          {t("review.addDiscount")}
        </button>
      </div>
      {discounts.map((discount) => (
        <div
          key={discount.id}
          className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-2"
        >
          <label className={labelClass}>
            <span>{t("review.discountRawName")}</span>
            <input
              value={discount.rawName}
              onChange={(event) =>
                updateDiscount(discount.id, {
                  rawName: event.target.value,
                })
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>{t("review.discountDescription")}</span>
            <input
              value={discount.description}
              onChange={(event) =>
                updateDiscount(discount.id, {
                  description: event.target.value,
                })
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>{t("review.discountAmount")}</span>
            <input
              inputMode="decimal"
              value={discount.amount}
              onChange={(event) =>
                updateDiscount(discount.id, {
                  amount: event.target.value,
                })
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>{t("review.appliesTo")}</span>
            <select
              value={discount.appliesToItemIndex ?? ""}
              onChange={(event) =>
                updateDiscount(discount.id, {
                  appliesToItemIndex:
                    event.target.value === ""
                      ? null
                      : Number(event.target.value),
                })
              }
              className={inputClass}
            >
              <option value="">{t("review.wholeReceipt")}</option>
              {items.map((item, index) => (
                <option key={item.id} value={index}>
                  {t("review.itemNumber", { number: index + 1 })}:{" "}
                  {item.rawName}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onRemove(discount.id)}
            className="justify-self-start text-sm text-red-700"
          >
            {t("review.removeDiscount")}
          </button>
        </div>
      ))}
    </section>
  );
}

export default DiscountEditor;
