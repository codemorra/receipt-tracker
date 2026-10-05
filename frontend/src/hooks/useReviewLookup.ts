import { useEffect, useState } from "react";
import {
  getReviewLookup,
  ReviewApiError,
  type LookupKind,
  type LookupOption,
  type ReviewErrorCode,
} from "../api/review-api";

/**
 * Custom hook for performing a review lookup based on the specified kind and query.
 * @param kind - The type of lookup to perform.
 * @param query - The search query string.
 * @param active - Whether the lookup should be active.
 * @param onError - Callback function to handle errors.
 * @returns An object containing the lookup options, loading state, failure state, and a retry function.
 */
export function useReviewLookup(
  kind: LookupKind,
  query: string,
  active: boolean,
  onError: (code: ReviewErrorCode) => void,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    options: LookupOption[];
    failed: boolean;
  } | null>(null);
  const normalized = query.trim();
  const key = `${kind}:${normalized}:${attempt}`;

  // Effect for performing the review lookup based on the current parameters.
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        getReviewLookup(kind, normalized, controller.signal)
          .then((options) => {
            if (!controller.signal.aborted)
              setResult({ key, options, failed: false });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setResult({ key, options: [], failed: true });
            onError(
              error instanceof ReviewApiError
                ? error.code
                : "unexpected_response",
            );
          });
      },
      normalized ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, kind, normalized, key, onError]);
  return {
    options: result?.key === key ? result.options : [],
    loading: active && result?.key !== key,
    failed: result?.key === key && result.failed,
    retry: () => setAttempt((value) => value + 1),
  };
}
