import type { SavedReceipt } from "../api/receipt-api.ts";
import {
  isValidDate,
  parseCents,
  type LineType,
  type ReviewDraft,
  type WarrantyType,
} from "../review/review-state.ts";

// Interface for the read-only receipt summary model.
export interface ReceiptSummaryModel {
  merchantName: string | null;
  merchantRawName: string | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  currency: string | null;
  totalCents: number | null;
  items: {
    key: string;
    position: number;
    name: string;
    rawName: string;
    quantity: number | null;
    unit: string | null;
    unitPriceCents: number | null;
    totalPriceCents: number | null;
    lineType: LineType;
    product: null | {
      name: string;
      brandName: string | null;
      productGroupName: string | null;
      categoryName: string | null;
      packageAmount: number | null;
      packageUnit: string | null;
    };
    warranties: {
      key: string;
      type: WarrantyType;
      startDate: string | null;
      endDate: string | null;
      notes: string | null;
    }[];
  }[];
  discounts: {
    key: string;
    itemKey: string | null;
    description: string | null;
    amountCents: number | null;
  }[];
}

/**
 * Converts a saved receipt into a read-only receipt summary model.
 * @param receipt The saved receipt to convert.
 * @returns The corresponding receipt summary model.
 */
export function savedReceiptToSummary(
  receipt: SavedReceipt,
): ReceiptSummaryModel {
  return {
    merchantName: receipt.merchantName,
    merchantRawName: receipt.merchantRawName,
    purchaseDate: receipt.purchaseDate,
    purchaseTime: receipt.purchaseTime,
    currency: receipt.currency,
    totalCents: receipt.totalCents,
    items: receipt.items.map((item) => ({
      key: String(item.id),
      position: item.position,
      name: item.product?.name ?? item.rawName,
      rawName: item.rawName,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
      lineType: item.lineType,
      product: item.product
        ? {
            name: item.product.name,
            brandName: item.product.brandName,
            productGroupName: item.product.productGroupName,
            categoryName: item.product.categoryName,
            packageAmount: item.product.packageAmount,
            packageUnit: item.product.packageUnit,
          }
        : null,
      warranties: item.warranties.map((warranty) => ({
        key: String(warranty.id),
        type: warranty.type,
        startDate: warranty.startDate,
        endDate: warranty.endDate,
        notes: warranty.notes,
      })),
    })),
    discounts: receipt.discounts.map((discount) => ({
      key: String(discount.id),
      itemKey:
        discount.receiptItemId === null ? null : String(discount.receiptItemId),
      description: discount.description,
      amountCents: discount.amountCents,
    })),
  };
}

/**
 * Trims the input string and returns null if the result is empty.
 * @param value The input string to trim.
 * @returns The trimmed string or null if empty.
 */
const text = (value: string) => value.trim() || null;
const date = (value: string) => (isValidDate(value) ? value : null);
function positiveDecimal(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  const number = Number(normalized);
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) &&
    Number.isFinite(number) &&
    number > 0
    ? number
    : null;
}

/**
 * Converts a review draft into a read-only receipt summary model.
 * @param draft The review draft to convert.
 * @returns The corresponding receipt summary model.
 */
export function reviewDraftToSummary(draft: ReviewDraft): ReceiptSummaryModel {
  return {
    merchantName: text(draft.merchantName),
    merchantRawName: text(draft.merchantRawName),
    purchaseDate: date(draft.purchaseDate),
    purchaseTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.purchaseTime)
      ? draft.purchaseTime
      : null,
    currency: /^[A-Z]{3}$/.test(draft.currency) ? draft.currency : null,
    totalCents: parseCents(draft.total),
    items: draft.items.map((item, position) => {
      const isProduct = item.lineType === "product";
      const selected = isProduct && item.productId !== null;
      const name =
        (selected ? text(item.selectedProductName ?? "") : null) ??
        (isProduct ? text(item.normalizedName) : null) ??
        item.rawName;
      const details = item.selectedProductDetails;
      return {
        key: item.id,
        position,
        name,
        rawName: item.rawName,
        quantity: positiveDecimal(item.quantity),
        unit: item.unit || null,
        unitPriceCents: parseCents(item.unitPrice),
        totalPriceCents: parseCents(item.totalPrice),
        lineType: item.lineType,
        product: !isProduct
          ? null
          : {
              name,
              brandName: selected
                ? (details?.brandName ?? null)
                : text(item.brand),
              productGroupName: selected
                ? (details?.productGroupName ?? null)
                : text(item.productGroup),
              categoryName: selected
                ? (details?.categoryName ?? null)
                : text(item.category),
              packageAmount: selected
                ? (details?.packageAmount ?? null)
                : positiveDecimal(item.packageAmount),
              packageUnit: selected
                ? (details?.packageUnit ?? null)
                : item.packageUnit || null,
            },
        warranties: item.warranties.map((warranty) => ({
          key: warranty.id,
          type: warranty.type,
          startDate: date(warranty.startDate),
          endDate: date(warranty.endDate),
          notes: text(warranty.notes),
        })),
      };
    }),
    discounts: draft.discounts.map((discount) => ({
      key: discount.id,
      itemKey:
        discount.appliesToItemIndex === null
          ? null
          : (draft.items[discount.appliesToItemIndex]?.id ?? null),
      description: text(discount.description) ?? text(discount.rawName),
      amountCents: parseCents(discount.amount),
    })),
  };
}
