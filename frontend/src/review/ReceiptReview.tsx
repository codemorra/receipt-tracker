import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LookupSelect, { type LookupOption } from "./LookupSelect";
import {
  buildFinalSaveDto,
  chooseProduct,
  createReviewDraft,
  reviewIssues,
  reviewSumStatus,
  warrantyDateIssue,
  type DiscountDraft,
  type ItemDraft,
  type LineType,
  type ReviewDraft,
  type ReviewDto,
  type Unit,
  type WarrantyDraft,
  type WarrantyType,
} from "./review-state";

// Types for categories and products used in the receipt review.
type Category = LookupOption;
interface Product extends LookupOption {
  brandName?: string | null;
  productGroupName?: string;
  categoryName?: string;
  packageAmount?: number | null;
  packageUnit?: string | null;
}

const units: Unit[] = ["pcs", "g", "kg", "ml", "l"];
const lineTypes: LineType[] = ["product", "deposit", "fee", "other"];
const warrantyTypes: WarrantyType[] = ["statutory", "manufacturer", "extended"];
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

// Default categories used for labeling and validation.
interface Props {
  review: ReviewDto;
}

// Props for the ReceiptReview component.
function ReceiptReview({ review }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ReviewDraft>(() =>
    createReviewDraft(review),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [openWarrantyIds, setOpenWarrantyIds] = useState<string[]>([]);
  const [openProductIds, setOpenProductIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedReceiptId, setSavedReceiptId] = useState<number | null>(null);
  const sumStatus = reviewSumStatus(draft);
  const issues = reviewIssues(draft);

  // Function to handle the confirmation of the receipt.
  async function confirmReceipt() {
    const finalSave = buildFinalSaveDto(draft);
    if (!finalSave || saving || savedReceiptId !== null) return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/scans/${review.scanId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalSave),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = typeof result.error === "string" ? result.error : "";
        setSaveError(
          error === "scan_archive_not_found"
            ? "review.saveArchiveMissing"
            : error === "confirmed_entity_not_found"
              ? "review.saveEntityMissing"
              : error === "invalid_final_save"
                ? "review.saveInvalid"
                : "review.saveFailed",
        );
        return;
      }
      setSavedReceiptId(result.receiptId);
    } catch {
      setSaveError("errors.network");
    } finally {
      setSaving(false);
    }
  }

  // Fetch categories from the API when the component mounts.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Categories failed");
        return response.json() as Promise<Category[]>;
      })
      .then((result) => {
        setCategories(result);
        setCategoriesFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCategoriesFailed(true);
      });
    return () => controller.abort();
  }, []);

  // Toggle the open state of product details.
  function toggleProductDetails(id: string) {
    setOpenProductIds((current) =>
      current.includes(id)
        ? current.filter((itemId) => itemId !== id)
        : [...current, id],
    );
  }

  // Set the open state of a warranty section.
  function setWarrantyOpen(id: string, open: boolean) {
    setOpenWarrantyIds((current) => {
      const alreadyOpen = current.includes(id);
      if (alreadyOpen === open) return current;
      return open
        ? [...current, id]
        : current.filter((itemId) => itemId !== id);
    });
  }

  // Update an item in the draft by its ID.
  function updateItem(id: string, changes: Partial<ItemDraft>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    }));
  }

  // Update a warranty in the draft by its item ID and warranty ID.
  function updateWarranty(
    itemId: string,
    warrantyId: string,
    changes: Partial<WarrantyDraft>,
  ) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              warranties: item.warranties.map((warranty) =>
                warranty.id === warrantyId
                  ? { ...warranty, ...changes }
                  : warranty,
              ),
            }
          : item,
      ),
    }));
  }

  // Update a discount in the draft by its ID.
  function updateDiscount(id: string, changes: Partial<DiscountDraft>) {
    setDraft((current) => ({
      ...current,
      discounts: current.discounts.map((discount) =>
        discount.id === id ? { ...discount, ...changes } : discount,
      ),
    }));
  }

  // Get the display label for a category, using a default translation if available.
  function categoryLabel(name: string) {
    return defaultCategories.has(name) ? t(`review.categories.${name}`) : name;
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
  const labelClass = "block space-y-1 text-sm font-medium";

  return (
    <section
      aria-labelledby="review-heading"
      className="mt-8 space-y-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header>
        <h2 id="review-heading" className="text-xl font-semibold">
          {t("review.heading")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("review.hint")}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          <span>{t("review.merchantRawName")}</span>
          <input
            value={draft.merchantRawName}
            onChange={(event) =>
              setDraft({ ...draft, merchantRawName: event.target.value })
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{t("review.merchantName")}</span>
          <input
            value={draft.merchantName}
            disabled={draft.merchantId !== null}
            onChange={(event) =>
              setDraft({ ...draft, merchantName: event.target.value })
            }
            className={inputClass}
          />
        </label>
        <div>
          {draft.merchantMatchStatus && (
            <p className="mb-1 text-sm text-slate-600">
              {t("review.matchStatus")}:{" "}
              {t(`review.match.${draft.merchantMatchStatus}`)}
            </p>
          )}
          <LookupSelect
            label={t("review.existingMerchant")}
            selectedLabel={t("review.selectedMerchant")}
            endpoint="/api/merchants"
            selectedId={draft.merchantId}
            initialOptions={draft.merchantCandidates.map((candidate) => ({
              id: candidate.merchantId,
              name: candidate.name,
            }))}
            onSelect={(option) =>
              setDraft((current) => ({
                ...current,
                merchantId: option?.id ?? null,
                merchantName: option?.name ?? current.merchantName,
                merchantMatchStatus: null,
              }))
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className={labelClass}>
            <span>{t("review.purchaseDate")}</span>
            <input
              type="date"
              value={draft.purchaseDate}
              onChange={(event) =>
                setDraft({ ...draft, purchaseDate: event.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            <span>{t("review.purchaseTime")}</span>
            <input
              type="time"
              value={draft.purchaseTime}
              onChange={(event) =>
                setDraft({ ...draft, purchaseTime: event.target.value })
              }
              className={inputClass}
            />
          </label>
        </div>
        <label className={labelClass}>
          <span>{t("review.currency")}</span>
          <input
            value={draft.currency}
            maxLength={3}
            onChange={(event) =>
              setDraft({
                ...draft,
                currency: event.target.value.toUpperCase(),
              })
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          <span>{t("review.total")}</span>
          <input
            inputMode="decimal"
            value={draft.total}
            onChange={(event) =>
              setDraft({ ...draft, total: event.target.value })
            }
            className={inputClass}
          />
        </label>
      </div>

      <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm">
        {t(`review.sum.${sumStatus}`)}
      </div>

      {issues.length > 0 && (
        <section
          aria-labelledby="review-issues-heading"
          className="rounded-lg bg-amber-50 p-4"
        >
          <h3 id="review-issues-heading" className="font-semibold">
            {t("review.issuesHeading")}
          </h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {issues.map((issue, index) => (
              <li key={index}>
                {t(`review.issues.${issue.code}`, { number: issue.number })}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="items-heading" className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h3 id="items-heading" className="text-lg font-semibold">
            {t("review.items")}
          </h3>
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                items: [
                  ...current.items,
                  {
                    id: crypto.randomUUID(),
                    rawName: "",
                    normalizedName: "",
                    productId: null,
                    selectedProductName: null,
                    matchStatus: null,
                    matchCandidates: null,
                    brand: "",
                    brandId: null,
                    productGroup: "",
                    productGroupId: null,
                    category: "",
                    packageAmount: "",
                    packageUnit: "",
                    quantity: "1",
                    unit: "",
                    unitPrice: "",
                    totalPrice: "",
                    lineType: "product",
                    sourceLineIndexes: [],
                    warranties: [],
                  },
                ],
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            {t("review.addItem")}
          </button>
        </div>

        {draft.items.map((item, index) => (
          <article
            key={item.id}
            className="space-y-4 rounded-xl border border-slate-200 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-semibold">
                {t("review.itemNumber", { number: index + 1 })}
              </h4>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    items: current.items.filter(
                      (entry) => entry.id !== item.id,
                    ),
                    discounts: current.discounts.map((discount) => ({
                      ...discount,
                      appliesToItemIndex:
                        discount.appliesToItemIndex === index
                          ? null
                          : discount.appliesToItemIndex !== null &&
                              discount.appliesToItemIndex > index
                            ? discount.appliesToItemIndex - 1
                            : discount.appliesToItemIndex,
                    })),
                  }))
                }
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
                aria-expanded={openProductIds.includes(item.id)}
                aria-controls={`product-details-${item.id}`}
                onClick={() => toggleProductDetails(item.id)}
                className="text-sm font-medium text-emerald-800"
              >
                {t(
                  openProductIds.includes(item.id)
                    ? "review.hideProductDetails"
                    : "review.productDetails",
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  updateItem(item.id, {
                    warranties: [
                      ...item.warranties,
                      {
                        id: crypto.randomUUID(),
                        type: "statutory",
                        startDate: draft.purchaseDate,
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
            </div>

            <div
              id={`product-details-${item.id}`}
              hidden={!openProductIds.includes(item.id)}
            >
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
                    onChange={(event) =>
                      updateItem(item.id, {
                        lineType: event.target.value as LineType,
                        productId:
                          event.target.value === "product"
                            ? item.productId
                            : null,
                        selectedProductName:
                          event.target.value === "product"
                            ? item.selectedProductName
                            : null,
                        matchStatus:
                          event.target.value === "product"
                            ? item.matchStatus
                            : null,
                      })
                    }
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
                            <option value="">
                              {t("review.chooseCategory")}
                            </option>
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

            {item.warranties.length > 0 && (
              <details
                open={openWarrantyIds.includes(item.id)}
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
                          <p
                            role="alert"
                            className="text-sm text-red-700 md:col-span-2"
                          >
                            {t(`review.warrantyIssues.${issue}`)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </article>
        ))}
      </section>

      <section aria-labelledby="discounts-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="discounts-heading" className="text-lg font-semibold">
            {t("review.discounts")}
          </h3>
          <button
            type="button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                discounts: [
                  ...current.discounts,
                  {
                    id: crypto.randomUUID(),
                    rawName: "",
                    description: "",
                    amount: "",
                    appliesToItemIndex: null,
                    sourceLineIndexes: [],
                  },
                ],
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            {t("review.addDiscount")}
          </button>
        </div>
        {draft.discounts.map((discount) => (
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
                {draft.items.map((item, index) => (
                  <option key={item.id} value={index}>
                    {t("review.itemNumber", { number: index + 1 })}:{" "}
                    {item.rawName}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  discounts: current.discounts.filter(
                    (entry) => entry.id !== discount.id,
                  ),
                }))
              }
              className="justify-self-start text-sm text-red-700"
            >
              {t("review.removeDiscount")}
            </button>
          </div>
        ))}
      </section>
      {saveError && (
        <p role="alert" className="text-sm text-red-700">
          {t(saveError)}
        </p>
      )}
      {savedReceiptId !== null ? (
        <p role="status" className="text-sm text-emerald-800">
          {t("review.saved", { id: savedReceiptId })}
        </p>
      ) : (
        <button
          type="button"
          disabled={saving || issues.length > 0}
          onClick={() => void confirmReceipt()}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {t(saving ? "review.saving" : "review.save")}
        </button>
      )}
      {categoriesFailed && (
        <p role="alert" className="text-sm text-red-700">
          {t("review.categoriesError")}
        </p>
      )}
    </section>
  );
}

export default ReceiptReview;
