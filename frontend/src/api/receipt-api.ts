import { isDuplicateCandidate } from "./review-api.ts";
import type {
  buildFinalSaveDto,
  DuplicateCandidate,
  LineType,
  Unit,
  WarrantyType,
} from "../review/review-state";

// Receipt API error codes and error class
export type ReceiptErrorCode =
  | "invalid_final_save"
  | "scan_archive_not_found"
  | "confirmed_entity_not_found"
  | "receipt_save_failed"
  | "receipt_not_found"
  | "receipt_detail_failed"
  | "receipt_list_failed"
  | "invalid_receipt_query"
  | "scan_cancel_failed"
  | "network_error"
  | "unexpected_response";
export class ReceiptApiError extends Error {
  readonly code: ReceiptErrorCode;
  constructor(code: ReceiptErrorCode) {
    super(code);
    this.name = "ReceiptApiError";
    this.code = code;
  }
}

// SavedReceipt interface and related type guards
export interface SavedReceipt {
  id: number;
  merchantId: number;
  merchantName: string;
  merchantRawName: string | null;
  purchaseDate: string;
  purchaseTime: string | null;
  totalCents: number;
  currency: string;
  imageUrl: string;
  items: {
    id: number;
    position: number;
    rawName: string;
    quantity: number;
    unit: Unit | null;
    unitPriceCents: number | null;
    totalPriceCents: number;
    lineType: LineType;
    product: null | {
      id: number;
      name: string;
      brandName: string | null;
      productGroupName: string | null;
      categoryName: string | null;
      packageAmount: number | null;
      packageUnit: Unit | null;
    };
    warranties: {
      id: number;
      receiptItemId: number;
      type: WarrantyType;
      startDate: string;
      endDate: string;
      notes: string | null;
    }[];
  }[];
  discounts: {
    id: number;
    receiptItemId: number | null;
    description: string | null;
    amountCents: number;
  }[];
}

// Interface for the receipt list response from the API.
export interface ReceiptList {
  items: (Pick<
    SavedReceipt,
    | "id"
    | "merchantId"
    | "merchantName"
    | "purchaseDate"
    | "purchaseTime"
    | "totalCents"
    | "currency"
  > & { warrantyCount: number })[];
  page: number;
  pageSize: 20;
  totalItems: number;
  totalPages: number;
}

// Type guards for primitive and structured types used in SavedReceipt validation
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const unit = (value: unknown) =>
  value === null || ["pcs", "g", "kg", "ml", "l"].includes(value as string);
const date = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/**
 * Type guard for verifying if a value conforms to the ReceiptList interface.
 * @param value - The value to check.
 * @returns True if the value is a ReceiptList, false otherwise.
 */
export function isReceiptList(value: unknown): value is ReceiptList {
  if (
    !record(value) ||
    !id(value.page) ||
    value.pageSize !== 20 ||
    !Number.isSafeInteger(value.totalItems) ||
    (value.totalItems as number) < 0 ||
    value.totalPages !== Math.ceil((value.totalItems as number) / 20) ||
    (value.totalItems === 0 && value.page !== 1) ||
    !Array.isArray(value.items)
  )
    return false;
  const expectedItems =
    (value.page as number) > (value.totalPages as number)
      ? 0
      : Math.min(
          20,
          (value.totalItems as number) - ((value.page as number) - 1) * 20,
        );
  return (
    value.items.length === expectedItems &&
    value.items.every(
      (item: unknown) =>
        record(item) &&
        id(item.id) &&
        id(item.merchantId) &&
        typeof item.merchantName === "string" &&
        date(item.purchaseDate) &&
        (item.purchaseTime === null ||
          (typeof item.purchaseTime === "string" &&
            /^([01]\d|2[0-3]):[0-5]\d$/.test(item.purchaseTime))) &&
        Number.isSafeInteger(item.totalCents) &&
        typeof item.currency === "string" &&
        /^[A-Z]{3}$/.test(item.currency) &&
        Number.isSafeInteger(item.warrantyCount) &&
        (item.warrantyCount as number) >= 0,
    ) &&
    new Set(value.items.map((item) => item.id)).size === value.items.length
  );
}

/**
 * Type guard for verifying if a value conforms to the SavedReceipt interface.
 * @param value - The value to check.
 * @returns True if the value is a SavedReceipt, false otherwise.
 */
export function isSavedReceipt(value: unknown): value is SavedReceipt {
  if (
    !record(value) ||
    !id(value.id) ||
    !id(value.merchantId) ||
    typeof value.merchantName !== "string" ||
    !nullableText(value.merchantRawName) ||
    !date(value.purchaseDate) ||
    !(
      value.purchaseTime === null ||
      (typeof value.purchaseTime === "string" &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(value.purchaseTime))
    ) ||
    !Number.isSafeInteger(value.totalCents) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/.test(value.currency) ||
    value.imageUrl !== `/api/receipts/${value.id}/image` ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.discounts)
  )
    return false;
  const items = value.items;
  return (
    items.every(
      (item: unknown) =>
        record(item) &&
        id(item.id) &&
        Number.isSafeInteger(item.position) &&
        (item.position as number) >= 0 &&
        typeof item.rawName === "string" &&
        typeof item.quantity === "number" &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        unit(item.unit) &&
        (item.unitPriceCents === null ||
          Number.isSafeInteger(item.unitPriceCents)) &&
        Number.isSafeInteger(item.totalPriceCents) &&
        ["product", "deposit", "fee", "other"].includes(
          item.lineType as string,
        ) &&
        (item.product === null ||
          (record(item.product) &&
            id(item.product.id) &&
            typeof item.product.name === "string" &&
            ["brandName", "productGroupName", "categoryName"].every((key) =>
              nullableText((item.product as Record<string, unknown>)[key]),
            ) &&
            (item.product.packageAmount === null ||
              (typeof item.product.packageAmount === "number" &&
                Number.isFinite(item.product.packageAmount) &&
                item.product.packageAmount > 0)) &&
            unit(item.product.packageUnit))) &&
        Array.isArray(item.warranties) &&
        item.warranties.every(
          (warranty: unknown) =>
            record(warranty) &&
            id(warranty.id) &&
            warranty.receiptItemId === item.id &&
            ["statutory", "manufacturer", "extended"].includes(
              warranty.type as string,
            ) &&
            date(warranty.startDate) &&
            date(warranty.endDate) &&
            warranty.endDate >= warranty.startDate &&
            nullableText(warranty.notes),
        ),
    ) &&
    value.discounts.every(
      (discount: unknown) =>
        record(discount) &&
        id(discount.id) &&
        nullableText(discount.description) &&
        Number.isSafeInteger(discount.amountCents) &&
        (discount.amountCents as number) > 0 &&
        (discount.receiptItemId === null ||
          items.some(
            (item) => record(item) && item.id === discount.receiptItemId,
          )),
    )
  );
}

/**
 * Wrapper function for making network requests to the receipt API.
 * @param path - The API endpoint path.
 * @param init - The request initialization options.
 * @returns The fetch Response object.
 * @throws ReceiptApiError if a network error occurs.
 */
async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { ...init, cache: "no-store" });
  } catch {
    if (init.signal?.aborted) throw new DOMException("", "AbortError");
    throw new ReceiptApiError("network_error");
  }
}

/**
 * Wrapper function for parsing the JSON body of a fetch Response.
 * @param response - The fetch Response object.
 * @returns The parsed JSON value.
 * @throws ReceiptApiError if the response body is not valid JSON.
 */
async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ReceiptApiError("unexpected_response");
  }
}

/**
 * Confirms a receipt with the given scan ID and receipt data.
 * @param scanId - The scan ID of the receipt.
 * @param receipt - The receipt data to confirm.
 * @param duplicateOverride - Whether to override duplicate detection.
 * @param signal - Optional AbortSignal for request cancellation.
 * @returns An object indicating whether the receipt was saved or if duplicates were found.
 * @throws ReceiptApiError if the confirmation fails or the response is unexpected.
 */
export async function confirmReceipt(
  scanId: string,
  receipt: NonNullable<ReturnType<typeof buildFinalSaveDto>>,
  duplicateOverride = false,
  signal?: AbortSignal,
): Promise<
  | { kind: "saved"; receiptId: number }
  | { kind: "duplicates"; candidates: DuplicateCandidate[] }
> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      scanId,
    )
  )
    throw new ReceiptApiError("unexpected_response");
  const response = await request(`/api/scans/${scanId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...receipt, duplicateOverride }),
    signal,
  });
  const value = await json(response);
  if (response.ok && record(value) && id(value.receiptId))
    return { kind: "saved", receiptId: value.receiptId as number };
  if (
    response.status === 409 &&
    record(value) &&
    value.error === "duplicate_confirmation_required"
  ) {
    if (
      !Array.isArray(value.candidates) ||
      value.candidates.length === 0 ||
      !value.candidates.every(isDuplicateCandidate)
    )
      throw new ReceiptApiError("unexpected_response");
    return { kind: "duplicates", candidates: value.candidates };
  }
  const known = [
    "invalid_final_save",
    "scan_archive_not_found",
    "confirmed_entity_not_found",
    "receipt_save_failed",
  ] as const;
  throw new ReceiptApiError(
    record(value)
      ? (known.find((code) => code === value.error) ?? "unexpected_response")
      : "unexpected_response",
  );
}

/**
 * Retrieves a saved receipt by its ID.
 * @param receiptId - The ID of the saved receipt.
 * @param signal - Optional AbortSignal for request cancellation.
 * @returns The saved receipt data.
 * @throws ReceiptApiError if the receipt is not found or the response is unexpected.
 */
export async function getSavedReceipt(
  receiptId: number,
  signal?: AbortSignal,
): Promise<SavedReceipt> {
  if (!id(receiptId)) throw new ReceiptApiError("receipt_not_found");
  const response = await request(`/api/receipts/${receiptId}`, { signal });
  if (!response.ok)
    throw new ReceiptApiError(
      response.status === 404 ? "receipt_not_found" : "receipt_detail_failed",
    );
  const value = await json(response);
  if (!isSavedReceipt(value) || value.id !== receiptId)
    throw new ReceiptApiError("unexpected_response");
  return value;
}

/**
 * Retrieves a paginated list of receipts based on the search query.
 * @param search - The search query string.
 * @param page - The page number to retrieve (default is 1).
 * @param signal - Optional AbortSignal for request cancellation.
 * @returns The receipt list for the specified page.
 * @throws ReceiptApiError if the query is invalid or the response is unexpected.
 */
export async function getReceipts(
  search: string,
  page = 1,
  signal?: AbortSignal,
): Promise<ReceiptList> {
  if (!id(page)) throw new ReceiptApiError("invalid_receipt_query");
  const query = new URLSearchParams({
    search: search.trim(),
    page: String(page),
  });
  const response = await request(`/api/receipts?${query}`, { signal });
  if (!response.ok)
    throw new ReceiptApiError(
      response.status === 400 ? "invalid_receipt_query" : "receipt_list_failed",
    );
  const value = await json(response);
  if (!isReceiptList(value) || (value.totalItems > 0 && value.page !== page))
    throw new ReceiptApiError("unexpected_response");
  return value;
}
