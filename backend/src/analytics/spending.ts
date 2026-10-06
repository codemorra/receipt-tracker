import { and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { merchants, receipts } from "../db/schema.js";
import type { SpendingQuery } from "./analytics-query.js";

// Granularity options for the spending timeline.
type Granularity = "daily" | "weekly" | "monthly";
type TimelinePeriod = {
  period: string;
  totalCents: number;
  receiptCount: number;
};

// Interface for the spending data transfer object (DTO).
export interface SpendingDto {
  currency: string | null;
  range: { from: string | null; to: string | null };
  granularity: Granularity;
  summary: {
    totalCents: number;
    receiptCount: number;
    averageReceiptCents: number | null;
  };
  timeline: TimelinePeriod[];
  merchants: {
    merchantId: number;
    name: string;
    receiptCount: number;
    totalCents: number;
  }[];
}

// Error class for handling spending-related exceptions.
export class SpendingError extends Error {
  constructor(
    readonly code: "merchant_not_found" | "analytics_mixed_currencies",
  ) {
    super(code);
    this.name = "SpendingError";
  }
}

const DAY_MS = 86_400_000;
const calendarDate = (value: string) => new Date(`${value}T00:00:00Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Calculates the start date of a given period based on the specified granularity.
 * @param value The date string in ISO format (YYYY-MM-DD).
 * @param granularity The granularity of the period ("daily", "weekly", or "monthly").
 * @returns The start date of the period as a Date object.
 */
function periodStart(value: string, granularity: Granularity): Date {
  const date = calendarDate(value);
  if (granularity === "weekly")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (granularity === "monthly") date.setUTCDate(1);
  return date;
}

/**
 * Fills in the timeline with aggregate data for the specified period and granularity.
 * Missing periods are filled with zero values.
 * @param rows The existing timeline rows with aggregate data.
 * @param from The start date of the timeline (inclusive) in ISO format (YYYY-MM-DD).
 * @param to The end date of the timeline (inclusive) in ISO format (YYYY-MM-DD).
 * @param granularity The granularity of the timeline ("daily", "weekly", or "monthly").
 * @returns The complete timeline with all periods filled.
 */
function fillTimeline(
  rows: TimelinePeriod[],
  from: string | null,
  to: string | null,
  granularity: Granularity,
): TimelinePeriod[] {
  if (!from || !to) return [];
  const values = new Map(rows.map((row) => [row.period, row]));
  const timeline: TimelinePeriod[] = [];
  const date = periodStart(from, granularity);
  const end = periodStart(to, granularity).getTime();
  while (date.getTime() <= end) {
    const period = isoDate(date);
    timeline.push(
      values.get(period) ?? { period, totalCents: 0, receiptCount: 0 },
    );
    if (granularity === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
    else
      date.setUTCDate(date.getUTCDate() + (granularity === "weekly" ? 7 : 1));
  }
  return timeline;
}

/**
 * Loads spending data from the database based on the specified query.
 * @param db The database instance.
 * @param query The spending query parameters.
 * @returns The spending data transfer object (DTO) containing the summary and timeline.
 */
export function loadSpending(db: Database, query: SpendingQuery): SpendingDto {
  const predicate = and(
    query.from === undefined
      ? undefined
      : gte(receipts.purchaseDate, query.from),
    query.to === undefined ? undefined : lte(receipts.purchaseDate, query.to),
    query.merchantId === undefined
      ? undefined
      : eq(receipts.merchantId, query.merchantId),
  );
  const total = sql<number>`coalesce(sum(${receipts.totalCents}), 0)`.mapWith(
    Number,
  );

  return db.transaction((tx) => {
    if (
      query.merchantId !== undefined &&
      !tx
        .select({ id: merchants.id })
        .from(merchants)
        .where(eq(merchants.id, query.merchantId))
        .get()
    )
      throw new SpendingError("merchant_not_found");

    const summary = tx
      .select({
        totalCents: total,
        receiptCount: count(),
        firstDate: sql<string | null>`min(${receipts.purchaseDate})`,
        lastDate: sql<string | null>`max(${receipts.purchaseDate})`,
        currency: sql<string | null>`min(${receipts.currency})`,
        currencyCount:
          sql<number>`count(distinct ${receipts.currency})`.mapWith(Number),
      })
      .from(receipts)
      .where(predicate)
      .get()!;
    if (summary.currencyCount > 1)
      throw new SpendingError("analytics_mixed_currencies");

    const range = {
      from: query.from ?? summary.firstDate,
      to: query.to ?? summary.lastDate,
    };
    const days =
      range.from && range.to
        ? (calendarDate(range.to).getTime() -
            calendarDate(range.from).getTime()) /
            DAY_MS +
          1
        : 0;
    const granularity: Granularity =
      days <= 45 ? "daily" : days <= 183 ? "weekly" : "monthly";
    const period =
      granularity === "daily"
        ? sql<string>`${receipts.purchaseDate}`
        : granularity === "weekly"
          ? sql<string>`date(${receipts.purchaseDate}, '-' || ((cast(strftime('%w', ${receipts.purchaseDate}) as integer) + 6) % 7) || ' days')`
          : sql<string>`strftime('%Y-%m-01', ${receipts.purchaseDate})`;
    const timeline = tx
      .select({ period, totalCents: total, receiptCount: count() })
      .from(receipts)
      .where(predicate)
      .groupBy(period)
      .orderBy(asc(period))
      .all();
    const breakdown = tx
      .select({
        merchantId: merchants.id,
        name: merchants.name,
        receiptCount: count(),
        totalCents: total,
      })
      .from(receipts)
      .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
      .where(predicate)
      .groupBy(merchants.id, merchants.name)
      .orderBy(desc(total), asc(merchants.name), asc(merchants.id))
      .all();
    return {
      currency: summary.currency,
      range,
      granularity,
      summary: {
        totalCents: summary.totalCents,
        receiptCount: summary.receiptCount,
        averageReceiptCents:
          summary.receiptCount === 0
            ? null
            : Math.sign(summary.totalCents) *
              Math.round(Math.abs(summary.totalCents) / summary.receiptCount),
      },
      timeline: fillTimeline(timeline, range.from, range.to, granularity),
      merchants: breakdown,
    };
  });
}
