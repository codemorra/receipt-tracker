import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LookupOption } from "../../api/review-api";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import type { ItemDraft, LineType, Unit } from "../../review/review-state";
import { SelectField, TextField } from "../ui/FormField";
import LookupField from "../ui/LookupField";
import InlineConfirmation from "../ui/InlineConfirmation";
import ReviewMatchBadge from "./ReviewMatchBadge";
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
 */
export default function ReviewItemEditor({
  item,
  index,
  categories,
  controller,
}: {
  item: ItemDraft;
  index: number;
  categories: LookupOption[];
  controller: ReturnType<typeof useReceiptReview>;
}) {
  const { t } = useTranslation();
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const product = item.lineType === "product";
  const unitOptions = [
    { value: "", label: t("pages.import.review.noUnit") },
    ...units.map((unit) => ({
      value: unit,
      label: t(`pages.import.review.units.${unit}`),
    })),
  ];
  const productOptions =
    item.matchCandidates?.candidates.map((candidate) => ({
      id: candidate.productId,
      name: candidate.name,
      brandName: candidate.brand,
      productGroupName: candidate.productGroup,
      packageAmount: candidate.packageAmount,
      packageUnit: candidate.packageUnit,
    })) ?? [];
  const productLabel = (option: LookupOption) =>
    [
      option.name,
      option.brandName,
      option.productGroupName,
      option.packageAmount && option.packageUnit
        ? `${option.packageAmount} ${option.packageUnit}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-shell bg-canvas/25 p-4">
      {confirmRemoval && (
        <InlineConfirmation
          title={t("pages.import.review.removeItem", { number: index + 1 })}
          message={t("pages.import.review.removeItemConfirmation", {
            name:
              item.selectedProductName || item.normalizedName || item.rawName,
          })}
          confirmLabel={t("pages.import.review.confirmRemoval")}
          cancelLabel={t("pages.import.review.cancel")}
          onCancel={() => setConfirmRemoval(false)}
          onConfirm={() => controller.removeItem(item.id)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-muted">
          {t("pages.import.review.itemNumber", { number: index + 1 })}
        </h4>
        <div className="flex items-center gap-3">
          <ReviewMatchBadge
            status={item.matchStatus}
            selected={item.productId !== null}
            applicable={product}
          />
          <button
            type="button"
            onClick={() => setConfirmRemoval(true)}
            aria-label={t("pages.import.review.removeItem", {
              number: index + 1,
            })}
            title={t("pages.import.review.removeItem", { number: index + 1 })}
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
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
        <TextField
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
      <details className="border-t border-shell pt-3">
        <summary className="cursor-pointer text-xs font-medium text-accent">
          {t("pages.import.review.itemDetails")}
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <TextField
            label={t("pages.import.review.rawName")}
            value={item.rawName}
            onChange={(event) =>
              controller.updateItem(item.id, {
                rawName: event.target.value,
                matchStatus: null,
              })
            }
          />
          {product && (
            <>
              <LookupField
                label={t("pages.import.review.existingProduct")}
                kind="products"
                selectedId={item.productId}
                selectedName={item.selectedProductName ?? item.normalizedName}
                initialOptions={productOptions}
                optionLabel={productLabel}
                onSelect={(option) => controller.selectProduct(item.id, option)}
                onError={controller.reportError}
              />
              {item.productId !== null && (
                <dl className="grid grid-cols-2 gap-3 text-xs sm:col-span-2">
                  {[
                    {
                      label: t("pages.import.review.brandName"),
                      value: item.selectedProductDetails?.brandName,
                    },
                    {
                      label: t("pages.import.review.productGroupName"),
                      value: item.selectedProductDetails?.productGroupName,
                    },
                    {
                      label: t("pages.import.review.packageAmount"),
                      value:
                        item.selectedProductDetails?.packageAmount?.toString(),
                    },
                    {
                      label: t("pages.import.review.packageUnit"),
                      value: item.selectedProductDetails?.packageUnit
                        ? t(
                            `pages.import.review.units.${item.selectedProductDetails.packageUnit}`,
                            {
                              defaultValue:
                                item.selectedProductDetails.packageUnit,
                            },
                          )
                        : null,
                    },
                    {
                      label: t("pages.import.review.category"),
                      rightColumn: true,
                      value: item.selectedProductDetails?.categoryName
                        ? t(
                            `pages.import.review.categories.${item.selectedProductDetails.categoryName}`,
                            {
                              defaultValue:
                                item.selectedProductDetails.categoryName,
                            },
                          )
                        : null,
                    },
                  ].map(({ label, value, rightColumn }) => (
                    <div
                      key={label}
                      className={
                        rightColumn ? "col-start-2 min-w-0" : "min-w-0"
                      }
                    >
                      <dt className="text-muted">{label}</dt>
                      <dd className="mt-1 wrap-break-word">
                        {value || t("pages.import.review.unknown")}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {item.productId === null && (
                <>
                  <TextField
                    label={t("pages.import.review.brandName")}
                    value={item.brand}
                    disabled={item.brandId !== null}
                    onChange={(event) =>
                      controller.updateItem(item.id, {
                        brand: event.target.value,
                        brandId: null,
                        matchStatus: null,
                      })
                    }
                  />
                  <LookupField
                    label={t("pages.import.review.existingBrand")}
                    kind="brands"
                    selectedId={item.brandId}
                    selectedName={item.brand}
                    onSelect={(option) =>
                      controller.updateItem(item.id, {
                        brandId: option?.id ?? null,
                        brand: option?.name ?? item.brand,
                      })
                    }
                    onError={controller.reportError}
                  />
                  <TextField
                    label={t("pages.import.review.productGroupName")}
                    value={item.productGroup}
                    disabled={item.productGroupId !== null}
                    onChange={(event) =>
                      controller.updateItem(item.id, {
                        productGroup: event.target.value,
                        productGroupId: null,
                        matchStatus: null,
                      })
                    }
                  />
                  <LookupField
                    label={t("pages.import.review.existingGroup")}
                    kind="product-groups"
                    selectedId={item.productGroupId}
                    selectedName={item.productGroup}
                    optionLabel={(option) =>
                      `${option.name} · ${option.categoryName ?? ""}`
                    }
                    onSelect={(option) =>
                      controller.updateItem(item.id, {
                        productGroupId: option?.id ?? null,
                        productGroup: option?.name ?? item.productGroup,
                        category: option?.categoryName ?? item.category,
                      })
                    }
                    onError={controller.reportError}
                  />
                  <TextField
                    label={t("pages.import.review.packageAmount")}
                    inputMode="decimal"
                    value={item.packageAmount}
                    onChange={(event) =>
                      controller.updateItem(item.id, {
                        packageAmount: event.target.value,
                        matchStatus: null,
                      })
                    }
                  />
                  <SelectField
                    label={t("pages.import.review.packageUnit")}
                    value={item.packageUnit}
                    options={unitOptions}
                    onChange={(value) =>
                      controller.updateItem(item.id, {
                        packageUnit: value as Unit | "",
                        matchStatus: null,
                      })
                    }
                  />
                  <div className="sm:col-start-2">
                    <SelectField
                      label={t("pages.import.review.category")}
                      value={item.category}
                      disabled={item.productGroupId !== null}
                      options={[
                        {
                          value: "",
                          label: t("pages.import.review.chooseCategory"),
                        },
                        ...(item.category &&
                        !categories.some(
                          (entry) => entry.name === item.category,
                        )
                          ? [
                              {
                                value: item.category,
                                label: t(
                                  `pages.import.review.categories.${item.category}`,
                                  { defaultValue: item.category },
                                ),
                              },
                            ]
                          : []),
                        ...categories.map((category) => ({
                          value: category.name,
                          label: t(
                            `pages.import.review.categories.${category.name}`,
                            { defaultValue: category.name },
                          ),
                        })),
                      ]}
                      onChange={(value) =>
                        controller.updateItem(item.id, {
                          category: value,
                          productGroupId: null,
                          matchStatus: null,
                        })
                      }
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </details>
      {product && <ItemWarrantyEditor item={item} controller={controller} />}
    </article>
  );
}
