import { useCallback, useState } from "react";
import type { LookupOption, ReviewErrorCode } from "../api/review-api";
import {
  createReviewDraft,
  createEmptyItem,
  removeReviewItem,
  chooseProduct,
  changeLineType,
  addItemWarranty,
  reviewIssues,
  reviewSumStatus,
  type ReviewDto,
  type ReviewDraft,
  type ItemDraft,
  type LineType,
  type DiscountDraft,
  type WarrantyDraft,
} from "../review/review-state";

/**
 * Custom hook for managing the state and actions related to a receipt review.
 * @param review - The initial review data.
 * @returns An object containing the draft, issues, sum status, notice, and various action functions.
 */
export function useReceiptReview(review: ReviewDto) {
  const [draft, setDraft] = useState(() => createReviewDraft(review));
  const [notice, setNotice] = useState<{
    id: number;
    code: ReviewErrorCode;
  } | null>(null);

  const reportError = useCallback((code: ReviewErrorCode) => {
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, code }));
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);
  function updateReceipt(
    changes: Partial<Omit<ReviewDraft, "items" | "discounts">>,
  ) {
    setDraft((current) => ({ ...current, ...changes }));
  }

  /**
   * Updates the receipt draft with the specified changes.
   * @param changes - Partial changes to apply to the receipt draft.
   */
  function selectMerchant(option: LookupOption | null) {
    setDraft((current) => ({
      ...current,
      merchantId: option?.id ?? null,
      merchantName: option?.name ?? current.merchantName,
      merchantMatchStatus: null,
    }));
  }

  /**
   * Changes the specified item in the receipt draft.
   * @param id - The ID of the item to change.
   * @param apply - A function that applies changes to the item.
   * @returns None. The draft is updated internally.
   */
  function changeItem(id: string, apply: (item: ItemDraft) => ItemDraft) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? apply(item) : item)),
    }));
  }

  /**
   * Updates the specified item in the receipt draft with the given changes.
   * @param id - The ID of the item to update.
   * @param changes - Partial changes to apply to the item.
   */
  function updateItem(id: string, changes: Partial<ItemDraft>) {
    changeItem(id, (item) => ({ ...item, ...changes }));
  }

  /**
   * Selects a product for the specified item in the receipt draft.
   * @param id - The ID of the item.
   * @param option - The lookup option representing the selected product.
   */
  function selectProduct(id: string, option: LookupOption | null) {
    changeItem(id, (item) => chooseProduct(item, option));
  }

  /**
   * Sets the line type for the specified item in the receipt draft.
   * @param id - The ID of the item.
   * @param lineType - The new line type to set.
   */
  function setLineType(id: string, lineType: LineType) {
    changeItem(id, (item) => changeLineType(item, lineType));
  }

  /**
   * Adds a new item to the receipt draft.
   */
  function addItem() {
    const item = createEmptyItem();
    setDraft((current) => ({ ...current, items: [...current.items, item] }));
    return item.id;
  }

  /**
   * Removes an item from the receipt draft.
   * @param id - The ID of the item to remove.
   */
  function removeItem(id: string) {
    setDraft((current) => removeReviewItem(current, id));
  }

  /**
   * Adds a new discount to the receipt draft.
   */
  function addDiscount() {
    const discount: DiscountDraft = {
      id: crypto.randomUUID(),
      rawName: "",
      description: "",
      amount: "",
      appliesToItemIndex: null,
      sourceLineIndexes: [],
    };
    setDraft((current) => ({
      ...current,
      discounts: [...current.discounts, discount],
    }));
  }

  /**
   * Updates the specified discount in the receipt draft with the given changes.
   * @param id - The ID of the discount to update.
   * @param changes - Partial changes to apply to the discount.
   */
  function updateDiscount(id: string, changes: Partial<DiscountDraft>) {
    setDraft((current) => ({
      ...current,
      discounts: current.discounts.map((discount) =>
        discount.id === id ? { ...discount, ...changes } : discount,
      ),
    }));
  }

  /**
   * Removes the specified discount from the receipt draft.
   * @param id - The ID of the discount to remove.
   */
  function removeDiscount(id: string) {
    setDraft((current) => ({
      ...current,
      discounts: current.discounts.filter((discount) => discount.id !== id),
    }));
  }

  /**
   * Adds a new warranty to the specified item in the receipt draft.
   * @param id - The ID of the item to add the warranty to.
   * @param values - The values for the new warranty, excluding the ID.
   */
  function addWarranty(id: string, values: Omit<WarrantyDraft, "id">) {
    const warranty: WarrantyDraft = {
      ...values,
      id: crypto.randomUUID(),
    };
    changeItem(id, (item) => addItemWarranty(item, warranty));
    return warranty.id;
  }

  /**
   * Updates the specified warranty for the given item in the receipt draft.
   * @param itemId - The ID of the item containing the warranty.
   * @param id - The ID of the warranty to update.
   * @param changes - Partial changes to apply to the warranty.
   */
  function updateWarranty(
    itemId: string,
    id: string,
    changes: Partial<WarrantyDraft>,
  ) {
    changeItem(itemId, (item) => ({
      ...item,
      warranties: item.warranties.map((warranty) =>
        warranty.id === id ? { ...warranty, ...changes } : warranty,
      ),
    }));
  }

  /**
   * Removes the specified warranty from the given item in the receipt draft.
   * @param itemId - The ID of the item containing the warranty.
   * @param id - The ID of the warranty to remove.
   */
  function removeWarranty(itemId: string, id: string) {
    changeItem(itemId, (item) => ({
      ...item,
      warranties: item.warranties.filter((warranty) => warranty.id !== id),
    }));
  }
  return {
    draft,
    issues: reviewIssues(draft),
    sumStatus: reviewSumStatus(draft),
    notice,
    reportError,
    dismissNotice,
    updateReceipt,
    selectMerchant,
    updateItem,
    selectProduct,
    setLineType,
    addItem,
    removeItem,
    addDiscount,
    updateDiscount,
    removeDiscount,
    addWarranty,
    updateWarranty,
    removeWarranty,
  };
}
