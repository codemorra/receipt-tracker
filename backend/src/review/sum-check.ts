import type { ReceiptExtraction } from "../extraction/receipt-extraction.js";

// Module for checking the sum of receipt items against the total amount, considering discounts and a tolerance.
export interface SumCheck {
  status: "MATCH" | "MISMATCH" | "INCOMPLETE";
  itemSumCents: number | null;
  discountSumCents: number;
  differenceCents: number | null;
}

/**
 * Checks the sum of receipt items against the total amount, considering discounts and a tolerance.
 * @param extraction The extracted receipt data containing items, discounts, and the total amount.
 * @param toleranceCents The allowed tolerance in cents for the sum check. Defaults to 1 cent.
 * @returns An object representing the result of the sum check, including status, item sum, discount sum, and difference.
 */
export function checkReceiptSum(
  extraction: ReceiptExtraction,
  toleranceCents = 1,
): SumCheck {
  const discountSumCents = extraction.discounts.reduce(
    (sum, discount) => sum + discount.amountCents,
    0,
  );
  if (
    extraction.totalCents === null ||
    extraction.items.some((item) => item.totalPriceCents === null)
  ) {
    return {
      status: "INCOMPLETE",
      itemSumCents: null,
      discountSumCents,
      differenceCents: null,
    };
  }

  const itemSumCents = extraction.items.reduce(
    (sum, item) => sum + item.totalPriceCents!,
    0,
  );
  const differenceCents =
    itemSumCents - discountSumCents - extraction.totalCents;
  return {
    status: Math.abs(differenceCents) <= toleranceCents ? "MATCH" : "MISMATCH",
    itemSumCents,
    discountSumCents,
    differenceCents,
  };
}
