import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import LookupSelect, { type LookupOption } from "./LookupSelect";
import DuplicateComparison from "./DuplicateComparison";
import ReceiptItemEditor from "./ReceiptItemEditor";
import DiscountEditor from "./DiscountEditor";
import {
  buildFinalSaveDto,
  createReviewDraft,
  reviewIssues,
  reviewSumStatus,
  type DiscountDraft,
  type DuplicateCandidate,
  type ItemDraft,
  type ReviewDraft,
  type ReviewDto,
  type WarrantyDraft,
} from "./review-state";

// Type for categories used in the receipt review.
type Category = LookupOption;

// Props for the ReceiptReview component.
interface Props {
  review: ReviewDto;
  onCancelled: () => void;
  onSaved: (receiptId: number) => void;
}

// Props for the ReceiptReview component.
function ReceiptReview({ review, onCancelled, onSaved }: Props) {
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
  const [duplicateCandidates, setDuplicateCandidates] = useState<
    DuplicateCandidate[]
  >(review.duplicateCandidates ?? []);
  const [cancelling, setCancelling] = useState(false);
  const sumStatus = reviewSumStatus(draft);
  const issues = reviewIssues(draft);

  // Function to handle the confirmation of the receipt.
  async function confirmReceipt(duplicateOverride = false) {
    const finalSave = buildFinalSaveDto(draft);
    if (!finalSave || saving || cancelling || savedReceiptId !== null) return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/scans/${review.scanId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...finalSave, duplicateOverride }),
      });
      const result = await response.json();
      if (!response.ok) {
        const error = typeof result.error === "string" ? result.error : "";
        if (
          error === "duplicate_confirmation_required" &&
          Array.isArray(result.candidates)
        ) {
          setDuplicateCandidates(result.candidates as DuplicateCandidate[]);
          return;
        }
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
      onSaved(result.receiptId);
    } catch {
      setSaveError("errors.network");
    } finally {
      setSaving(false);
    }
  }

  // Function to handle the cancellation of the receipt import.
  async function cancelImport() {
    if (saving || cancelling) return;
    setCancelling(true);
    setSaveError("");
    try {
      const response = await fetch(`/api/scans/${review.scanId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) {
        setSaveError("review.cancelFailed");
        return;
      }
      onCancelled();
    } catch {
      setSaveError("errors.network");
    } finally {
      setCancelling(false);
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
          <ReceiptItemEditor
            key={item.id}
            item={item}
            index={index}
            categories={categories}
            purchaseDate={draft.purchaseDate}
            productDetailsOpen={openProductIds.includes(item.id)}
            warrantyOpen={openWarrantyIds.includes(item.id)}
            toggleProductDetails={toggleProductDetails}
            setWarrantyOpen={setWarrantyOpen}
            updateItem={updateItem}
            updateWarranty={updateWarranty}
            onRemove={() =>
              setDraft((current) => ({
                ...current,
                items: current.items.filter((entry) => entry.id !== item.id),
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
          />
        ))}
      </section>

      <DiscountEditor
        discounts={draft.discounts}
        items={draft.items}
        updateDiscount={updateDiscount}
        onAdd={() =>
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
        onRemove={(id) =>
          setDraft((current) => ({
            ...current,
            discounts: current.discounts.filter((entry) => entry.id !== id),
          }))
        }
      />
      {duplicateCandidates.length > 0 && savedReceiptId === null && (
        <DuplicateComparison
          archiveUrl={review.archiveUrl}
          draft={draft}
          candidates={duplicateCandidates}
          busy={saving || cancelling}
          canImport={issues.length === 0}
          onCancel={() => void cancelImport()}
          onImport={() => void confirmReceipt(true)}
        />
      )}
      {saveError && (
        <p role="alert" className="text-sm text-red-700">
          {t(saveError)}
        </p>
      )}
      {savedReceiptId !== null ? (
        <p role="status" className="text-sm text-emerald-800">
          {t("review.saved", { id: savedReceiptId })}
        </p>
      ) : duplicateCandidates.length === 0 ? (
        <button
          type="button"
          disabled={saving || issues.length > 0}
          onClick={() => void confirmReceipt()}
          className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
        >
          {t(saving ? "review.saving" : "review.save")}
        </button>
      ) : null}
      {savedReceiptId === null && duplicateCandidates.length === 0 && (
        <button
          type="button"
          disabled={saving || cancelling}
          onClick={() => void cancelImport()}
          className="rounded-lg border border-slate-300 px-5 py-3 font-semibold disabled:opacity-50"
        >
          {t("review.cancelImport")}
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
