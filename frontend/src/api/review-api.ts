import type { DuplicateCandidate, ReviewDto } from "../review/review-state";

export type LookupKind =
  "categories" | "merchants" | "products" | "brands" | "product-groups";

// Interface representing a lookup option returned by the review API.
export interface LookupOption {
  id: number;
  name: string;
  brandName?: string | null;
  productGroupName?: string;
  categoryName?: string;
  categoryId?: number;
  packageAmount?: number | null;
  packageUnit?: string | null;
}

// Type representing the possible error codes returned by the review API.
export type ReviewErrorCode =
  | "lookup_failed"
  | "categories_failed"
  | "network_error"
  | "unexpected_response";

// Custom error class for handling review API errors.
export class ReviewApiError extends Error {
  readonly code: ReviewErrorCode;
  constructor(code: ReviewErrorCode) {
    super(code);
    this.name = "ReviewApiError";
    this.code = code;
  }
}

/**
 * Type guard for checking if a value is a record with string keys and unknown values.
 * @param value - The value to check.
 * @returns True if the value is a record with string keys and unknown values, false otherwise.
 */
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Type guards for various field types used in the review API.
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const identifier = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nullableMoney = (value: unknown) =>
  value === null || Number.isSafeInteger(value);
const packageAmount = (value: unknown) =>
  value === null ||
  (typeof value === "number" && Number.isFinite(value) && value > 0);
const unit = (value: unknown) =>
  value === null || ["pcs", "g", "kg", "ml", "l"].includes(value as string);
const sources = (value: unknown) =>
  Array.isArray(value) &&
  value.every((index) => Number.isSafeInteger(index) && index >= 0);

/**
 * Validates the match object for merchants and products.
 * @param value - The match object to validate.
 * @param kind - The kind of match, either "merchant" or "product".
 * @returns True if the match object is valid, false otherwise.
 */
function match(value: unknown, kind: "merchant" | "product"): boolean {
  if (
    !record(value) ||
    !["MATCHED", "SUGGESTED", "NEW"].includes(value.status as string) ||
    !Array.isArray(value.candidates)
  )
    return false;
  const id = `${kind}Id`;
  if (value[id] !== null && !identifier(value[id])) return false;
  return value.candidates.every((candidate: unknown) => {
    if (
      !record(candidate) ||
      !identifier(candidate[id]) ||
      typeof candidate.name !== "string"
    )
      return false;
    return (
      kind === "merchant" ||
      (nullableText(candidate.brand) &&
        typeof candidate.productGroup === "string" &&
        typeof candidate.category === "string" &&
        packageAmount(candidate.packageAmount) &&
        unit(candidate.packageUnit) &&
        typeof candidate.score === "number" &&
        Number.isFinite(candidate.score))
    );
  });
}

/**
 * Type guard for checking if a value is a DuplicateCandidate.
 * @param value - The value to check.
 * @returns True if the value is a DuplicateCandidate, false otherwise.
 */
export function isDuplicateCandidate(
  value: unknown,
): value is DuplicateCandidate {
  return (
    record(value) &&
    identifier(value.receiptId) &&
    identifier(value.merchantId) &&
    typeof value.merchantName === "string" &&
    typeof value.purchaseDate === "string" &&
    nullableText(value.purchaseTime) &&
    Number.isSafeInteger(value.totalCents) &&
    typeof value.currency === "string" &&
    /^[A-Z]{3}$/.test(value.currency) &&
    typeof value.imagePath === "string" &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        record(item) &&
        Number.isSafeInteger(item.position) &&
        (item.position as number) >= 0 &&
        typeof item.rawName === "string" &&
        typeof item.quantity === "number" &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        unit(item.unit) &&
        nullableMoney(item.unitPriceCents) &&
        Number.isSafeInteger(item.totalPriceCents) &&
        ["product", "deposit", "fee", "other"].includes(
          item.lineType as string,
        ) &&
        (item.productId === null || identifier(item.productId)),
    )
  );
}

/**
 * Type guard for checking if a value is a ReviewDto.
 * @param value - The value to check.
 * @returns True if the value is a ReviewDto, false otherwise.
 */
export function isReviewDto(value: unknown): value is ReviewDto {
  if (
    !record(value) ||
    typeof value.scanId !== "string" ||
    typeof value.archiveUrl !== "string" ||
    !record(value.merchant) ||
    !nullableText(value.merchant.rawName) ||
    !nullableText(value.merchant.normalizedName) ||
    !match(value.merchant.match, "merchant") ||
    !["purchaseDate", "purchaseTime", "currency"].every((key) =>
      nullableText(value[key]),
    ) ||
    !nullableMoney(value.totalCents) ||
    !Array.isArray(value.items) ||
    !Array.isArray(value.discounts) ||
    !Array.isArray(value.duplicateCandidates) ||
    !value.duplicateCandidates.every(isDuplicateCandidate) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) =>
      ["possible_duplicate", "sum_mismatch", "sum_incomplete"].includes(
        warning,
      ),
    )
  )
    return false;
  return (
    value.items.every(
      (item: unknown) =>
        record(item) &&
        typeof item.rawName === "string" &&
        ["normalizedName", "brand", "productGroup", "category"].every((key) =>
          nullableText(item[key]),
        ) &&
        packageAmount(item.packageAmount) &&
        unit(item.packageUnit) &&
        unit(item.unit) &&
        typeof item.quantity === "number" &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        nullableMoney(item.unitPriceCents) &&
        nullableMoney(item.totalPriceCents) &&
        ["product", "deposit", "fee", "other"].includes(
          item.lineType as string,
        ) &&
        sources(item.sourceLineIndexes) &&
        (item.match === null || match(item.match, "product")),
    ) &&
    value.discounts.every(
      (discount: unknown) =>
        record(discount) &&
        typeof discount.rawName === "string" &&
        nullableText(discount.description) &&
        Number.isSafeInteger(discount.amountCents) &&
        (discount.amountCents as number) > 0 &&
        (discount.appliesToItemIndex === null ||
          (Number.isSafeInteger(discount.appliesToItemIndex) &&
            (discount.appliesToItemIndex as number) >= 0 &&
            (discount.appliesToItemIndex as number) <
              (value.items as unknown[]).length)) &&
        sources(discount.sourceLineIndexes),
    )
  );
}

/**
 * Fetches review lookup options from the backend.
 * @param kind - The kind of lookup, either "categories" or other lookup types.
 * @param query - The search query string.
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns A promise that resolves to an array of LookupOption objects.
 * @throws ReviewApiError if the request fails or the response is malformed.
 */
export async function getReviewLookup(
  kind: LookupKind,
  query = "",
  signal?: AbortSignal,
): Promise<LookupOption[]> {
  let response: Response;
  try {
    response = await fetch(
      `/api/${kind}?query=${encodeURIComponent(query.trim())}`,
      { signal, cache: "no-store" },
    );
  } catch {
    if (signal?.aborted) throw new DOMException("", "AbortError");
    throw new ReviewApiError("network_error");
  }
  if (!response.ok)
    throw new ReviewApiError(
      kind === "categories" ? "categories_failed" : "lookup_failed",
    );
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ReviewApiError("unexpected_response");
  }
  if (
    !Array.isArray(value) ||
    !value.every((option: unknown) => {
      if (!option || typeof option !== "object") return false;
      const record = option as Record<string, unknown>;
      return (
        Number.isSafeInteger(record.id) &&
        (record.id as number) > 0 &&
        typeof record.name === "string" &&
        ["brandName", "packageUnit"].every(
          (key) =>
            record[key] === undefined ||
            record[key] === null ||
            typeof record[key] === "string",
        ) &&
        ["productGroupName", "categoryName"].every(
          (key) => record[key] === undefined || typeof record[key] === "string",
        ) &&
        (record.packageAmount === undefined ||
          record.packageAmount === null ||
          (typeof record.packageAmount === "number" &&
            Number.isFinite(record.packageAmount) &&
            record.packageAmount > 0)) &&
        (record.categoryId === undefined ||
          (Number.isSafeInteger(record.categoryId) &&
            (record.categoryId as number) > 0))
      );
    })
  )
    throw new ReviewApiError("unexpected_response");
  return value as LookupOption[];
}
