export const warrantyStatuses = [
  "not_started",
  "active",
  "expiring_soon",
  "expired",
] as const;
export type WarrantyStatus = (typeof warrantyStatuses)[number];

/**
 * Returns the server's local calendar day in YYYY-MM-DD format.
 * @param now The current date and time, defaults to the system's current date and time.
 * @returns The local calendar day in YYYY-MM-DD format.
 */
export function localCalendarDay(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Calculates the date 30 days from the given day, used to determine the "expiring soon" threshold.
 * @param today The current local calendar day in YYYY-MM-DD format.
 * @returns The local calendar day 30 days from today in YYYY-MM-DD format.
 */
export function expiringSoonThrough(today: string): string {
  const day = new Date(`${today}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 30);
  return day.toISOString().slice(0, 10);
}

/**
 * Determines the warranty status for a given date interval.
 * @param startDate The start date of the warranty in YYYY-MM-DD format.
 * @param endDate The end date of the warranty in YYYY-MM-DD format.
 * @param today The current local calendar day in YYYY-MM-DD format.
 * @returns The warranty status as one of "not_started", "active", "expiring_soon", or "expired".
 */
export function warrantyStatus(
  startDate: string,
  endDate: string,
  today: string,
): WarrantyStatus {
  if (today < startDate) return "not_started";
  if (endDate < today) return "expired";
  return endDate <= expiringSoonThrough(today) ? "expiring_soon" : "active";
}
