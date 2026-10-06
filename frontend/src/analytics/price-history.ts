import type { PriceHistoryDto } from "../api/analytics-api.ts";

export const DAY_MS = 86_400_000;
export type PricePoint = {
  x: number;
  y: number;
  purchase: PriceHistoryDto["history"][number];
};

/**
 * Converts a price history into chart points suitable for plotting.
 * Each point represents a purchase with a valid unit price.
 * @param history The price history to convert.
 * @returns An array of price points for charting.
 */
export function priceChartPoints(
  history: PriceHistoryDto["history"],
): PricePoint[] {
  return history.flatMap((purchase) =>
    purchase.unitPriceCents === null
      ? []
      : [
          {
            x: Date.parse(`${purchase.purchaseDate}T00:00:00Z`) / DAY_MS,
            y: purchase.unitPriceCents,
            purchase,
          },
        ],
  );
}
