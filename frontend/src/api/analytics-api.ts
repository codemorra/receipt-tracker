import {
  isCalendarDate,
  type SpendingFilters,
} from "../analytics/analytics-state.ts";

// DTO for spending analytics response.
export interface SpendingDto {
  currency: string | null;
  range: { from: string | null; to: string | null };
  granularity: "daily" | "weekly" | "monthly";
  summary: {
    totalCents: number;
    receiptCount: number;
    averageReceiptCents: number | null;
  };
  timeline: { period: string; totalCents: number; receiptCount: number }[];
  merchants: {
    merchantId: number;
    name: string;
    totalCents: number;
    receiptCount: number;
  }[];
}

// Error codes and API error class for analytics API.
export type AnalyticsErrorCode =
  | "invalid_analytics_query"
  | "merchant_not_found"
  | "analytics_mixed_currencies"
  | "analytics_spending_failed"
  | "merchant_lookup_failed"
  | "network_error"
  | "unexpected_response";

// Analytics API error class.
export class AnalyticsApiError extends Error {
  readonly code: AnalyticsErrorCode;
  constructor(code: AnalyticsErrorCode) {
    super(code);
    this.name = "AnalyticsApiError";
    this.code = code;
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) > 0;
const aggregate = (value: unknown) =>
  record(value) &&
  Number.isSafeInteger(value.totalCents) &&
  count(value.receiptCount);

/**
 * Type guard for the SpendingDto.
 * @param value The value to check.
 * @returns True if the value is a SpendingDto, false otherwise.
 */
export function isSpendingDto(value: unknown): value is SpendingDto {
  if (
    !record(value) ||
    !record(value.range) ||
    !record(value.summary) ||
    !aggregate(value.summary) ||
    !(
      value.currency === null ||
      (typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency))
    ) ||
    !["daily", "weekly", "monthly"].includes(value.granularity as string) ||
    ![value.range.from, value.range.to].every(
      (date) => date === null || isCalendarDate(date),
    ) ||
    (typeof value.range.from === "string" &&
      typeof value.range.to === "string" &&
      value.range.from > value.range.to) ||
    !(value.summary.receiptCount === 0
      ? value.summary.averageReceiptCents === null &&
        value.summary.totalCents === 0 &&
        value.currency === null
      : Number.isSafeInteger(value.summary.averageReceiptCents) &&
        value.currency !== null) ||
    !Array.isArray(value.timeline) ||
    !value.timeline.every(
      (row) => aggregate(row) && record(row) && isCalendarDate(row.period),
    ) ||
    !Array.isArray(value.merchants) ||
    !value.merchants.every(
      (row) =>
        aggregate(row) &&
        record(row) &&
        id(row.merchantId) &&
        typeof row.name === "string",
    )
  )
    return false;
  const timeline = value.timeline as SpendingDto["timeline"];
  const merchants = value.merchants as SpendingDto["merchants"];
  const summary = value.summary;
  return (
    timeline.every(
      (row, index) => index === 0 || timeline[index - 1].period < row.period,
    ) &&
    new Set(merchants.map((row) => row.merchantId)).size === merchants.length &&
    [timeline, merchants].every(
      (rows) =>
        rows.reduce((sum, row) => sum + row.totalCents, 0) ===
          summary.totalCents &&
        rows.reduce((sum, row) => sum + row.receiptCount, 0) ===
          summary.receiptCount,
    )
  );
}

/**
 * Makes a network request to the specified path and returns the response.
 * @param path The URL path to request.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns The Response object from the fetch call.
 * @throws AnalyticsApiError if the network request fails.
 */
async function request(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, { signal, cache: "no-store" });
  } catch {
    if (signal?.aborted) throw new DOMException("", "AbortError");
    throw new AnalyticsApiError("network_error");
  }
}

/**
 * Parses the JSON body of a Response object.
 * @param response The Response object to parse.
 * @returns The parsed JSON value.
 * @throws AnalyticsApiError if the response body is not valid JSON.
 */
async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AnalyticsApiError("unexpected_response");
  }
}

/**
 * Constructs the query string for spending analytics based on the given filters.
 * @param filters The spending filters.
 * @returns The query string for the spending analytics API.
 */
export function spendingQuery(filters: SpendingFilters): string {
  const params = new URLSearchParams();
  if (filters.from !== undefined) params.set("from", filters.from);
  if (filters.to !== undefined) params.set("to", filters.to);
  if (filters.merchantId !== undefined)
    params.set("merchantId", String(filters.merchantId));
  return params.toString();
}

/**
 * Fetches spending analytics data from the API based on the given query string.
 * @param query The query string for the spending analytics API.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns The SpendingDto object containing the spending analytics data.
 * @throws AnalyticsApiError if the network request fails or the response is invalid.
 */
export async function getSpending(
  query: string,
  signal?: AbortSignal,
): Promise<SpendingDto> {
  const response = await request(`/api/analytics/spending?${query}`, signal);
  if (!response.ok) {
    const code =
      response.status === 400
        ? "invalid_analytics_query"
        : response.status === 404
          ? "merchant_not_found"
          : response.status === 422
            ? "analytics_mixed_currencies"
            : "analytics_spending_failed";
    throw new AnalyticsApiError(code);
  }
  const value = await json(response);
  if (!isSpendingDto(value)) throw new AnalyticsApiError("unexpected_response");
  return value;
}

/**
 * Fetches analytics data for a specific merchant from the API.
 * @param merchantId The ID of the merchant to fetch analytics for.
 * @param signal Optional AbortSignal to cancel the request.
 * @returns An object containing the merchant's ID and name.
 * @throws AnalyticsApiError if the network request fails or the response is invalid.
 */
export async function getAnalyticsMerchant(
  merchantId: number,
  signal?: AbortSignal,
): Promise<{ id: number; name: string }> {
  const response = await request(`/api/merchants?id=${merchantId}`, signal);
  if (!response.ok)
    throw new AnalyticsApiError(
      response.status === 404 ? "merchant_not_found" : "merchant_lookup_failed",
    );
  const value = await json(response);
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !record(value[0]) ||
    value[0].id !== merchantId ||
    typeof value[0].name !== "string"
  )
    throw new AnalyticsApiError("unexpected_response");
  return { id: merchantId, name: value[0].name };
}
