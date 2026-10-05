import { useCallback, useEffect, useState } from "react";
import {
  getSavedReceipt,
  ReceiptApiError,
  type ReceiptErrorCode,
  type SavedReceipt,
} from "../api/receipt-api";

/**
 * Custom hook for fetching and managing the state of a saved receipt.
 * @param receiptId - The ID of the receipt to fetch.
 * @returns An object containing the receipt data, error code, notice, attempt count, and functions to dismiss the notice and retry fetching.
 */
export function useSavedReceipt(receiptId: number) {
  const [receipt, setReceipt] = useState<SavedReceipt | null>(null);
  const [error, setError] = useState<ReceiptErrorCode | null>(null);
  const [notice, setNotice] = useState<ReceiptErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const dismissNotice = useCallback(() => setNotice(null), []);

  // Effect for fetching the saved receipt whenever the receipt ID or attempt count changes.
  useEffect(() => {
    const controller = new AbortController();
    getSavedReceipt(receiptId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setReceipt(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const code =
          error instanceof ReceiptApiError ? error.code : "unexpected_response";
        setError(code);
        setNotice(code);
      });
    return () => controller.abort();
  }, [receiptId, attempt]);

  // Function to retry fetching the saved receipt.
  function retry() {
    setReceipt(null);
    setError(null);
    setNotice(null);
    setAttempt((value) => value + 1);
  }
  return { receipt, error, notice, attempt, dismissNotice, retry };
}
