import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/database.js";
import { merchants, receiptItems, receipts } from "../db/schema.js";

// Module for detecting potential duplicate receipts based on merchant, date, time, and total amount.

// Input structure for searching potential duplicate receipts.
export interface DuplicateSearchInput {
  merchantId: number | null;
  purchaseDate: string | null;
  purchaseTime: string | null;
  totalCents: number | null;
}

// Structure representing a potential duplicate receipt candidate.
export interface DuplicateCandidate {
  receiptId: number;
  merchantId: number;
  merchantName: string;
  purchaseDate: string;
  purchaseTime: string | null;
  totalCents: number;
  currency: string;
  imagePath: string;
  items: {
    position: number;
    rawName: string;
    quantity: number;
    unit: string | null;
    unitPriceCents: number | null;
    totalPriceCents: number;
    lineType: string;
    productId: number | null;
  }[];
}

/**
 * Converts a time string in "HH:MM" format to the number of minutes past midnight.
 * @param time The time string in "HH:MM" format.
 * @returns The number of minutes past midnight, or null if the input is invalid.
 */
function minutesFromMidnight(time: string | null): number | null {
  if (time === null) return null;
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  if (
    time.length !== 5 ||
    time[2] !== ":" ||
    ![...time.slice(0, 2), ...time.slice(3)].every(
      (digit) => digit >= "0" && digit <= "9",
    ) ||
    hours > 23 ||
    minutes > 59
  )
    return null;
  return hours * 60 + minutes;
}

/**
 * Finds potential duplicate receipt candidates based on the given search input.
 * @param db The database instance to query.
 * @param input The search input containing merchant ID, purchase date, purchase time, and total amount.
 * @returns An array of potential duplicate receipt candidates.
 */
export function findDuplicateCandidates(
  db: Pick<Database, "select">,
  input: DuplicateSearchInput,
): DuplicateCandidate[] {
  if (
    input.merchantId === null ||
    input.purchaseDate === null ||
    input.totalCents === null
  )
    return [];

  const matches = db
    .select({
      receiptId: receipts.id,
      merchantId: receipts.merchantId,
      merchantName: merchants.name,
      purchaseDate: receipts.purchaseDate,
      purchaseTime: receipts.purchaseTime,
      totalCents: receipts.totalCents,
      currency: receipts.currency,
      imagePath: receipts.imagePath,
    })
    .from(receipts)
    .innerJoin(merchants, eq(receipts.merchantId, merchants.id))
    .where(
      and(
        eq(receipts.merchantId, input.merchantId),
        eq(receipts.purchaseDate, input.purchaseDate),
        eq(receipts.totalCents, input.totalCents),
      ),
    )
    .all();
  if (matches.length === 0) return [];

  const items = db
    .select({
      receiptId: receiptItems.receiptId,
      position: receiptItems.position,
      rawName: receiptItems.rawName,
      quantity: receiptItems.quantity,
      unit: receiptItems.unit,
      unitPriceCents: receiptItems.unitPriceCents,
      totalPriceCents: receiptItems.totalPriceCents,
      lineType: receiptItems.lineType,
      productId: receiptItems.productId,
    })
    .from(receiptItems)
    .where(
      inArray(
        receiptItems.receiptId,
        matches.map((match) => match.receiptId),
      ),
    )
    .orderBy(asc(receiptItems.position))
    .all();
  const inputMinutes = minutesFromMidnight(input.purchaseTime);
  const distance = (time: string | null) => {
    const candidateMinutes = minutesFromMidnight(time);
    return inputMinutes === null || candidateMinutes === null
      ? Number.POSITIVE_INFINITY
      : Math.abs(inputMinutes - candidateMinutes);
  };

  return matches
    .map((match) => ({
      ...match,
      items: items
        .filter((item) => item.receiptId === match.receiptId)
        .map((item) => ({
          position: item.position,
          rawName: item.rawName,
          quantity: item.quantity,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          totalPriceCents: item.totalPriceCents,
          lineType: item.lineType,
          productId: item.productId,
        })),
    }))
    .sort(
      (left, right) =>
        distance(left.purchaseTime) - distance(right.purchaseTime) ||
        left.receiptId - right.receiptId,
    );
}
