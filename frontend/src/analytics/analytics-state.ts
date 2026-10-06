export const periods = [
  "last-30-days",
  "last-3-months",
  "this-year",
  "all-time",
  "custom",
] as const;
export type Period = (typeof periods)[number];

// Interface for the analytics state.
export interface AnalyticsState {
  tab: "spending" | "price-history";
  period: Period;
  from: string;
  to: string;
  merchantId: number | null;
  productId: number | null;
}

// Interface for the spending filters used in the analytics state.
export interface SpendingFilters {
  from?: string;
  to?: string;
  merchantId?: number;
}

/**
 * Checks if a given value is a valid calendar date in the format YYYY-MM-DD.
 * @param value The value to check.
 * @returns True if the value is a valid calendar date, false otherwise.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

/**
 * Parses the analytics search string from the URL and returns the corresponding state and validity.
 * @param search The URL search string.
 * @returns An object containing the parsed state and a flag indicating if the search string is invalid.
 */
export function parseAnalyticsSearch(search: string): {
  state: AnalyticsState;
  invalid: boolean;
} {
  const params = new URLSearchParams(search);
  let invalid = ["tab", "period", "from", "to", "merchantId", "productId"].some(
    (key) => params.getAll(key).length > 1,
  );
  const tab = params.get("tab") ?? "spending";
  const period = params.get("period") ?? "last-30-days";
  if (
    !["spending", "price-history"].includes(tab) ||
    !periods.includes(period as Period)
  )
    invalid = true;

  /**
   * Parses an identifier from the URL search parameters.
   * @param key The key of the parameter to parse.
   * @returns The parsed identifier as a number, or null if invalid.
   */
  function identifier(key: string): number | null {
    const value = params.get(key);
    if (value === null) return null;
    const id = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0) {
      invalid = true;
      return null;
    }
    return id;
  }
  const state: AnalyticsState = {
    tab: tab === "price-history" ? tab : "spending",
    period: periods.includes(period as Period)
      ? (period as Period)
      : "last-30-days",
    from: period === "custom" ? (params.get("from") ?? "") : "",
    to: period === "custom" ? (params.get("to") ?? "") : "",
    merchantId: identifier("merchantId"),
    productId: identifier("productId"),
  };
  return { state, invalid: invalid || spendingFilters(state) === null };
}

/**
 * Constructs the URL for the analytics page based on the given state.
 * @param state The analytics state.
 * @returns The URL string for the analytics page with the appropriate query parameters.
 */
export function analyticsUrl(state: AnalyticsState): string {
  const params = new URLSearchParams({ tab: state.tab, period: state.period });
  if (state.period === "custom") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  if (state.merchantId !== null)
    params.set("merchantId", String(state.merchantId));
  if (state.productId !== null)
    params.set("productId", String(state.productId));
  return `/analytics?${params}`;
}

/**
 * Constructs the spending filters based on the analytics state and the current date.
 * @param state The analytics state.
 * @param now The current date (used for relative periods like "last-30-days").
 * @returns The spending filters object or null if the state is invalid.
 */
export function spendingFilters(
  state: AnalyticsState,
  now = new Date(),
): SpendingFilters | null {
  const merchant =
    state.merchantId === null ? {} : { merchantId: state.merchantId };
  if (state.period === "all-time") return merchant;
  if (state.period === "custom")
    return isCalendarDate(state.from) &&
      isCalendarDate(state.to) &&
      state.from <= state.to
      ? { ...merchant, from: state.from, to: state.to }
      : null;
  const to = `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const from = new Date(`${to}T00:00:00Z`);
  if (state.period === "last-30-days") from.setUTCDate(from.getUTCDate() - 29);
  else if (state.period === "this-year") from.setUTCMonth(0, 1);
  else {
    const day = from.getUTCDate();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - 3);
    const end = new Date(from.getTime());
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    from.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  return { ...merchant, from: from.toISOString().slice(0, 10), to };
}
