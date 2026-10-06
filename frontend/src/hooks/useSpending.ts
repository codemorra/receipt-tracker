import { useEffect, useState } from "react";
import {
  AnalyticsApiError,
  getSpending,
  type AnalyticsErrorCode,
  type SpendingDto,
} from "../api/analytics-api";

/**
 * Custom hook for fetching and managing spending analytics data.
 * Retains the last result during filter loading; aborted requests cannot update it.
 * @param query The query string for fetching spending analytics data.
 * @returns An object containing the spending data, loading state, error, and a retry function.
 */
export function useSpending(query: string | null) {
  const [attempt, setAttempt] = useState(0);
  const key = `${query}:${attempt}`;
  const [result, setResult] = useState<{
    key: string;
    data: SpendingDto | null;
    error: AnalyticsErrorCode | null;
  } | null>(null);
  useEffect(() => {
    if (query === null) return;
    const controller = new AbortController();
    getSpending(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key,
          data: null,
          error:
            error instanceof AnalyticsApiError
              ? error.code
              : "unexpected_response",
        });
      });
    return () => controller.abort();
  }, [query, key]);
  return {
    data: result?.data ?? null,
    loading: query !== null && result?.key !== key,
    error: result?.key === key ? result.error : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
