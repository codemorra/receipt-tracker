import { useTranslation } from "react-i18next";
import LookupSelect, { type LookupOption } from "./LookupSelect";
import WarrantyEditor from "./WarrantyEditor";
import {
  chooseProduct,
  changeLineType,
  type ItemDraft,
  type LineType,
  type Unit,
  type WarrantyDraft,
} from "./review-state";

// Types for products used in the receipt item editor.
interface Product extends LookupOption {
  brandName?: string | null;
  productGroupName?: string;
  categoryName?: string;
  packageAmount?: number | null;
  packageUnit?: string | null;
}

const units: Unit[] = ["pcs", "g", "kg", "ml", "l"];
const lineTypes: LineType[] = ["product", "deposit", "fee", "other"];

// Default categories used for labeling and validation.
const defaultCategories = new Set([
  "food",
  "beverages",
  "drugstore",
  "household",
  "pet_supplies",
  "electronics",
  "clothing",
  "home_and_garden",
  "automotive",
  "leisure",
  "gastronomy",
  "services",
  "other",
]);

// Props for the ReceiptItemEditor component.
interface Props {
  item: ItemDraft;
  index: number;
  categories: LookupOption[];
  purchaseDate: string;
  productDetailsOpen: boolean;
  warrantyOpen: boolean;
  toggleProductDetails: (id: string) => void;
  setWarrantyOpen: (id: string, open: boolean) => void;
  updateItem: (id: string, changes: Partial<ItemDraft>) => void;
  updateWarranty: (
    itemId: string,
    warrantyId: string,
    changes: Partial<WarrantyDraft>,
  ) => void;
  onRemove: () => void;
}

// Component for editing a single receipt item.
function ReceiptItemEditor({
  item,
  index,
  categories,
  purchaseDate,
  productDetailsOpen,
  warrantyOpen,
  toggleProductDetails,
  setWarrantyOpen,
  updateItem,
  updateWarranty,
  onRemove,
}: Props) {
  const { t } = useTranslation();

  // Get the display label for a category, using a default translation if available.
  function categoryLabel(name: string) {
    return defaultCategories.has(name) ? t(`review.categories.${name}`) : name;
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
  const labelClass = "block space-y-1 text-sm font-medium";

  return (
    <article className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">
          {t("review.itemNumber", { number: index + 1 })}
        </h4>
        <button
          type="button"
          onClick={onRemove}
          className="text-sm text-red-700"
        >
          {t("review.removeItem")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className={labelClass}>
          <span>
            {t(
              item.lineType === "product"
                ? "review.productName"
                : "review.rawName",
            )}
          </span>
          <input
            value={
              item.lineType === "product"
                ? (item.selectedProductName ?? item.normalizedName)
                : item.rawName
            }
            onChange={(event) =>
              updateItem(
                item.id,
                item.lineType === "product"
                  ? {
                      normalizedName: event.target.value,
                      productId: null,
                      selectedProductName: null,
                      matchStatus: null,
                    }
                  : { rawName: event.target.value },
              )
            }
            className={inputClass}
          />
          {item.lineType === "product" &&
            item.rawName &&
            item.rawName !==
              (item.selectedProductName ?? item.normalizedName) && (
              <span className="text-xs font-normal text-slate-500">
                {t("review.rawName")}: {item.rawName}
              </span>
            )}
        </label>
        <p className="text-sm text-slate-600">
          {t("review.matchStatus")}:{" "}
          {item.lineType !== "product"
            ? t("review.noProductMatch")
            : item.matchStatus
              ? t(`review.match.${item.matchStatus}`)
              : item.productId !== null
                ? t("review.matchManual")
                : t("review.match.NEW")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className={labelClass}>
          <span>{t("review.quantity")}</span>
          <input
            inputMode="decimal"
            value={item.quantity}
            onChange={(event) =>
              updateItem(item.id, { quantity: event.target.value })
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{t("review.unit")}</span>
          <select
            value={item.unit}
            onChange={(event) =>
              updateItem(item.id, {
                unit: event.target.value as Unit | "",
              })
            }
            className={inputClass}
          >
            <option value="">{t("review.noUnit")}</option>
            {units.map((unit) => (
              <option key={unit} value={unit}>
                {t(`review.units.${unit}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          <span>{t("review.unitPrice")}</span>
          <input
            inputMode="decimal"
            value={item.unitPrice}
            onChange={(event) =>
              updateItem(item.id, { unitPrice: event.target.value })
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{t("review.itemTotal")}</span>
          <input
            inputMode="decimal"
            value={item.totalPrice}
            onChange={(event) =>
              updateItem(item.id, { totalPrice: event.target.value })
            }
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          aria-expanded={productDetailsOpen}
          aria-controls={`product-details-${item.id}`}
          onClick={() => toggleProductDetails(item.id)}
          className="text-sm font-medium text-emerald-800"
        >
          {t(
            productDetailsOpen
              ? "review.hideProductDetails"
              : "review.productDetails",
          )}
        </button>
        {item.lineType === "product" && (
          <button
            type="button"
            onClick={() => {
              updateItem(item.id, {
                warranties: [
                  ...item.warranties,
                  {
                    id: crypto.randomUUID(),
                    type: "statutory",
                    startDate: purchaseDate,
                    endDate: "",
                    notes: "",
                  },
                ],
              });
              setWarrantyOpen(item.id, true);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {t("review.addWarranty")}
          </button>
        )}
      </div>

      <div id={`product-details-${item.id}`} hidden={!productDetailsOpen}>
        <div className="grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
          <label className={labelClass}>
            <span>{t("review.rawName")}</span>
            <input
              value={item.rawName}
              onChange={(event) =>
                updateItem(item.id, {
                  rawName: event.target.value,
                  matchStatus: null,
                })
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>{t("review.lineType")}</span>
            <select
              value={item.lineType}
              onChange={(event) => {
                const lineType = event.target.value as LineType;
                updateItem(item.id, changeLineType(item, lineType));
                if (lineType !== "product") setWarrantyOpen(item.id, false);
              }}
              className={inputClass}
            >
              {lineTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`review.lineTypes.${type}`)}
                </option>
              ))}
            </select>
          </label>

          {item.lineType === "product" && (
            <>
              <div className="md:col-span-2">
                <LookupSelect<Product>
                  label={t("review.existingProduct")}
                  selectedLabel={t("review.selectedProduct")}
                  endpoint="/api/products"
                  selectedId={item.productId}
                  initialOptions={
                    item.matchCandidates?.candidates.map((candidate) => ({
                      id: candidate.productId,
                      name: candidate.name,
                      brandName: candidate.brand,
                      productGroupName: candidate.productGroup,
                      packageAmount: candidate.packageAmount,
                      packageUnit: candidate.packageUnit,
                    })) ?? []
                  }
                  optionLabel={(option) =>
                    [
                      option.name,
                      option.brandName,
                      option.productGroupName,
                      option.packageAmount && option.packageUnit
                        ? `${option.packageAmount} ${option.packageUnit}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
                  onSelect={(option) =>
                    updateItem(item.id, chooseProduct(item, option))
                  }
                />
              </div>
              {item.productId === null && (
                <>
                  <label className={labelClass}>
                    <span>{t("review.brandName")}</span>
                    <input
                      value={item.brand}
                      onChange={(event) =>
                        updateItem(item.id, {
                          brand: event.target.value,
                          brandId: null,
                          productId: null,
                          matchStatus: null,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>{t("review.productGroupName")}</span>
                    <input
                      value={item.productGroup}
                      onChange={(event) =>
                        updateItem(item.id, {
                          productGroup: event.target.value,
                          productGroupId: null,
                          productId: null,
                          matchStatus: null,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>{t("review.category")}</span>
                    <select
                      value={item.category}
                      onChange={(event) =>
                        updateItem(item.id, {
                          category: event.target.value,
                          productGroupId: null,
                          productId: null,
                          matchStatus: null,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">{t("review.chooseCategory")}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.name}>
                          {categoryLabel(category.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    <span>{t("review.packageAmount")}</span>
                    <input
                      inputMode="decimal"
                      value={item.packageAmount}
                      onChange={(event) =>
                        updateItem(item.id, {
                          packageAmount: event.target.value,
                          productId: null,
                          matchStatus: null,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className={labelClass}>
                    <span>{t("review.packageUnit")}</span>
                    <select
                      value={item.packageUnit}
                      onChange={(event) =>
                        updateItem(item.id, {
                          packageUnit: event.target.value as Unit | "",
                          productId: null,
                          matchStatus: null,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">{t("review.noUnit")}</option>
                      {units.map((unit) => (
                        <option key={unit} value={unit}>
                          {t(`review.units.${unit}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {item.lineType === "product" && item.warranties.length > 0 && (
        <WarrantyEditor
          item={item}
          open={warrantyOpen}
          setWarrantyOpen={setWarrantyOpen}
          updateItem={updateItem}
          updateWarranty={updateWarranty}
        />
      )}
    </article>
  );
}

export default ReceiptItemEditor;
