import { isCalendarDate } from "../analytics/analytics-state.ts";
import type { WarrantyType } from "../review/review-state";

export const warrantyStatuses = [
  "not_started",
  "active",
  "expiring_soon",
  "expired",
] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];
export const warrantyTypes: WarrantyType[] = [
  "statutory",
  "manufacturer",
  "extended",
];

// Interface definition for the structure of a warranty query.
export interface WarrantyQuery {
  search?: string;
  status?: WarrantyStatus;
  type?: WarrantyType;
  page?: number;
}

// Interface definition for the structure of a single warranty item within a WarrantyList.
export interface WarrantyList {
  items: {
    id: number;
    receiptId: number;
    receiptItemId: number;
    type: WarrantyType;
    startDate: string;
    endDate: string;
    status: WarrantyStatus;
    displayName: string;
    merchantName: string;
    purchaseDate: string;
  }[];
  page: number;
  pageSize: 20;
  totalItems: number;
  totalPages: number;
}

// Interface definitions for warranty API error handling.
export type WarrantyErrorCode =
  | "invalid_warranty_query"
  | "warranty_list_failed"
  | "network_error"
  | "unexpected_response";
export class WarrantyApiError extends Error {
  readonly code: WarrantyErrorCode;
  constructor(code: WarrantyErrorCode) {
    super(code);
    this.name = "WarrantyApiError";
    this.code = code;
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/**
 * Validates whether a given value conforms to the WarrantyList structure.
 * @param value The value to validate.
 * @returns True if the value is a valid WarrantyList, false otherwise.
 */
function isWarrantyList(value: unknown): value is WarrantyList {
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
  const expected =
    value.page > (value.totalPages as number)
      ? 0
      : Math.min(20, (value.totalItems as number) - (value.page - 1) * 20);
  return (
    value.items.length === expected &&
    value.items.every(
      (row: unknown) =>
        record(row) &&
        id(row.id) &&
        id(row.receiptId) &&
        id(row.receiptItemId) &&
        warrantyTypes.includes(row.type as WarrantyType) &&
        warrantyStatuses.includes(row.status as WarrantyStatus) &&
        isCalendarDate(row.startDate) &&
        isCalendarDate(row.endDate) &&
        row.startDate <= row.endDate &&
        isCalendarDate(row.purchaseDate) &&
        typeof row.displayName === "string" &&
        typeof row.merchantName === "string",
    ) &&
    new Set(value.items.map((row) => row.id)).size === value.items.length
  );
}

/**
 * Fetches a page of warranties from the backend API, preserving AbortError and sanitizing backend/network failures.
 * @param query The query parameters for filtering and pagination.
 * @param signal An optional AbortSignal to cancel the request.
 * @returns A promise that resolves to a WarrantyList.
 */
export async function getWarranties(
  query: WarrantyQuery = {},
  signal?: AbortSignal,
): Promise<WarrantyList> {
  const page = query.page ?? 1;
  if (
    !id(page) ||
    (query.status !== undefined && !warrantyStatuses.includes(query.status)) ||
    (query.type !== undefined && !warrantyTypes.includes(query.type))
  )
    throw new WarrantyApiError("invalid_warranty_query");
  const params = new URLSearchParams({
    search: query.search?.trim() ?? "",
    page: String(page),
  });
  if (query.status !== undefined) params.set("status", query.status);
  if (query.type !== undefined) params.set("type", query.type);
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`/api/warranties?${params}`, {
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    throw new WarrantyApiError("network_error");
  }
  if (!response.ok)
    throw new WarrantyApiError(
      response.status === 400
        ? "invalid_warranty_query"
        : "warranty_list_failed",
    );
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw error;
    throw new WarrantyApiError("unexpected_response");
  }
  signal?.throwIfAborted();
  if (!isWarrantyList(value) || (value.totalItems > 0 && value.page !== page))
    throw new WarrantyApiError("unexpected_response");
  return value;
}
