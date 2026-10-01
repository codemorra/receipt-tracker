import { useTranslation } from "react-i18next";
import {
  warrantyDateIssue,
  type ItemDraft,
  type WarrantyDraft,
  type WarrantyType,
} from "./review-state";

const warrantyTypes: WarrantyType[] = ["statutory", "manufacturer", "extended"];

// Props for the WarrantyEditor component.
interface Props {
  item: ItemDraft;
  open: boolean;
  setWarrantyOpen: (id: string, open: boolean) => void;
  updateItem: (id: string, changes: Partial<ItemDraft>) => void;
  updateWarranty: (
    itemId: string,
    warrantyId: string,
    changes: Partial<WarrantyDraft>,
  ) => void;
}

// Component for editing the warranty details of a single receipt item.
function WarrantyEditor({
  item,
  open,
  setWarrantyOpen,
  updateItem,
  updateWarranty,
}: Props) {
  const { t } = useTranslation();
  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
  const labelClass = "block space-y-1 text-sm font-medium";

  return (
    <details
      open={open}
      onToggle={(event) => {
        setWarrantyOpen(item.id, event.currentTarget.open);
      }}
      className="rounded-lg bg-slate-50 p-3"
    >
      <summary className="cursor-pointer text-sm font-medium">
        {t("review.warrantyCount", {
          count: item.warranties.length,
        })}
      </summary>
      <div className="mt-4 space-y-4">
        {item.warranties.map((warranty) => {
          const issue = warrantyDateIssue(warranty);
          return (
            <div
              key={warranty.id}
              className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2"
            >
              <label className={labelClass}>
                <span>{t("review.warrantyType")}</span>
                <select
                  value={warranty.type}
                  onChange={(event) =>
                    updateWarranty(item.id, warranty.id, {
                      type: event.target.value as WarrantyType,
                    })
                  }
                  className={inputClass}
                >
                  {warrantyTypes.map((type) => (
                    <option key={type} value={type}>
                      {t(`review.warrantyTypes.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() =>
                  updateItem(item.id, {
                    warranties: item.warranties.filter(
                      (entry) => entry.id !== warranty.id,
                    ),
                  })
                }
                className="self-end justify-self-start text-sm text-red-700"
              >
                {t("review.removeWarranty")}
              </button>
              <label className={labelClass}>
                <span>{t("review.startDate")}</span>
                <input
                  type="date"
                  value={warranty.startDate}
                  onChange={(event) =>
                    updateWarranty(item.id, warranty.id, {
                      startDate: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className={labelClass}>
                <span>{t("review.endDate")}</span>
                <input
                  type="date"
                  value={warranty.endDate}
                  onChange={(event) =>
                    updateWarranty(item.id, warranty.id, {
                      endDate: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} md:col-span-2`}>
                <span>{t("review.notes")}</span>
                <textarea
                  value={warranty.notes}
                  onChange={(event) =>
                    updateWarranty(item.id, warranty.id, {
                      notes: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              {issue && (
                <p role="alert" className="text-sm text-red-700 md:col-span-2">
                  {t(`review.warrantyIssues.${issue}`)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default WarrantyEditor;
