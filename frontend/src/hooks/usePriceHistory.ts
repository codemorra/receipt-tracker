import { useEffect, useState } from "react";
import {
  AnalyticsApiError,
  getPriceHistory,
  type AnalyticsErrorCode,
  type PriceHistoryDto,
} from "../api/analytics-api";

/**
 * Custom hook for fetching the price history of a specific product.
 * Retains data for filter changes and never shows the previous product after a selection change.
 * @param productId The ID of the product to fetch the price history for.
 * @param query The query string containing optional filters such as date range and merchant ID.
 * @returns An object containing the price history data, loading state, error code, and a retry function.
 */
export function usePriceHistory(
  productId: number | null,
  query: string | null,
) {
  const [attempt, setAttempt] = useState(0);
  const key = `${productId}:${query}:${attempt}`;
  const [result, setResult] = useState<{
    key: string;
    productId: number;
    data: PriceHistoryDto | null;
    error: AnalyticsErrorCode | null;
  } | null>(null);
  useEffect(() => {
    if (productId === null || query === null) return;
    const controller = new AbortController();
    getPriceHistory(productId, query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResult({ key, productId, data, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            productId,
            data: null,
            error:
              error instanceof AnalyticsApiError
                ? error.code
                : "unexpected_response",
          });
      });
    return () => controller.abort();
  }, [productId, query, key]);
  return {
    data:
      productId !== null && result?.productId === productId
        ? result.data
        : null,
    loading: productId !== null && query !== null && result?.key !== key,
    error: result?.key === key ? result.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
