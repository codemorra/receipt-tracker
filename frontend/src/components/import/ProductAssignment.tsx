import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LookupOption } from "../../api/review-api";
import type { ItemDraft, Unit } from "../../review/review-state";
import type { useReceiptReview } from "../../hooks/useReceiptReview";
import { SelectField, TextField } from "../ui/FormField";
import LookupField from "../ui/LookupField";
import ReviewMatchBadge from "./ReviewMatchBadge";

/**
 * Renders the product assignment interface for an item.
 * @param item - The item draft containing product information.
 * @param categories - The list of available product categories.
 * @param controller - The controller for handling receipt review actions.
 */
export default function ProductAssignment({
  item,
  categories,
  controller,
}: {
  item: ItemDraft;
  categories: LookupOption[];
  controller: ReturnType<typeof useReceiptReview>;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const unitOptions = [
    { value: "", label: t("pages.import.review.noUnit") },
    ...(["pcs", "g", "kg", "ml", "l"] as Unit[]).map((unit) => ({
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
      categoryName: candidate.category,
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
  const details = item.selectedProductDetails;
  const packageLabel =
    details?.packageAmount != null && details.packageUnit
      ? `${new Intl.NumberFormat(i18n.language).format(details.packageAmount)} ${t(`pages.import.review.units.${details.packageUnit}`, { defaultValue: details.packageUnit })}`
      : "—";
  return (
    <>
      <section className="space-y-3 border-t border-shell pt-4">
        <h5 className="text-sm font-semibold">
          {t("pages.import.review.productAssignment")}
        </h5>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ReviewMatchBadge
            status={item.matchStatus}
            selected={item.productId !== null}
          />
          <span className="min-w-0 wrap-break-word">
            {item.productId !== null
              ? (item.selectedProductName ?? item.normalizedName)
              : t("pages.import.review.noProductAssigned")}
          </span>
        </div>
        {editingText ? (
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
        ) : (
          <p className="text-xs wrap-break-word text-muted">
            {t("pages.import.review.rawName")}:{" "}
            <span className="text-foreground">{item.rawName || "—"}</span>
          </p>
        )}
        {editing ? (
          <div className="space-y-3">
            <LookupField
              label={t("pages.import.review.existingProduct")}
              kind="products"
              selectedId={item.productId}
              selectedName={item.selectedProductName ?? item.normalizedName}
              initialOptions={productOptions}
              optionLabel={productLabel}
              clearOptionLabel={t("pages.import.review.newProductAction")}
              onSelect={(option) => {
                controller.selectProduct(item.id, option);
                setEditing(false);
                setEditingText(false);
              }}
              onError={controller.reportError}
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setEditingText(!editingText)}
                className="rounded text-xs text-accent hover:underline"
              >
                {t(
                  editingText
                    ? "pages.import.review.finishReceiptText"
                    : "pages.import.review.editReceiptText",
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setEditingText(false);
                }}
                className="rounded text-xs text-muted hover:text-accent"
              >
                {t("pages.import.review.finishAssignment")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-shell px-3 py-2 text-xs font-medium hover:bg-surface-hover"
          >
            {t("pages.import.review.changeAssignment")}
          </button>
        )}
      </section>
      <section className="space-y-3 border-t border-shell pt-4">
        <h5 className="text-sm font-semibold">
          {t("pages.import.review.productDetails")}
        </h5>
        {item.productId !== null ? (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            {[
              {
                label: t("pages.import.review.brandName"),
                value: details?.brandName,
              },
              {
                label: t("pages.import.review.productGroupName"),
                value: details?.productGroupName,
              },
              {
                label: t("pages.import.review.category"),
                value: details?.categoryName
                  ? t(
                      `pages.import.review.categories.${details.categoryName}`,
                      { defaultValue: details.categoryName },
                    )
                  : null,
              },
              { label: t("pages.import.review.package"), value: packageLabel },
            ].map(({ label, value }) => (
              <div key={label} className="min-w-0">
                <dt className="text-muted">{label}</dt>
                <dd className="mt-1 wrap-break-word">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="grid gap-3 @min-[30rem]:grid-cols-2">
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
                  !categories.some((entry) => entry.name === item.category)
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
          </div>
        )}
      </section>
    </>
  );
}
