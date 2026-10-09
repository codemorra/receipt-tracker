import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmReceipt,
  ReceiptApiError,
  type ReceiptErrorCode,
} from "../api/receipt-api";
import {
  buildFinalSaveDto,
  type ReviewDto,
  type ReviewDraft,
} from "../review/review-state";
import {
  duplicateIdentity,
  duplicateReviewDecision,
  confirmDuplicateReview,
  type DuplicateReview,
} from "../review/duplicate-review";

/**
 * Custom hook for managing receipt confirmation, including handling duplicate candidates and saving.
 * @param review - The current review data for the receipt.
 * @param draft - The current draft state of the receipt review.
 * @param onSaved - Callback invoked when the receipt is successfully saved.
 * @param onBusyChange - Reports saving synchronously to the import navigation guard.
 * @returns An object containing the current duplicate candidates, busy state, notice, and functions to dismiss the notice, save.
 */
export function useReceiptConfirmation(
  review: ReviewDto,
  draft: ReviewDraft,
  onSaved: (id: number) => void,
  onBusyChange: (busy: boolean) => void,
  onMerchantConflict: (candidates: ReviewDraft["merchantCandidates"]) => void,
) {
  const [duplicates, setDuplicates] = useState<DuplicateReview>(() => ({
    identity: duplicateIdentity(draft),
    candidates: review.duplicateCandidates,
  }));
  const { candidates, action } = duplicateReviewDecision(draft, duplicates);
  const duplicatesConfirmed = action === "override";
  const [busy, setBusy] = useState<"save" | null>(null);
  const [notice, setNotice] = useState<{
    id: number;
    code: ReceiptErrorCode;
  } | null>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  /**
   * Runs the specified operation with the provided action, handling busy state, notice, and aborting.
   * @param operation - The operation being performed ("save").
   * @param action - The async action to execute, receiving an AbortSignal.
   */
  async function run<T>(
    operation: "save",
    action: (signal: AbortSignal) => Promise<T>,
  ) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(operation);
    onBusyChange(true);
    setNotice(null);
    try {
      return await action(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice({
          id: ++sequence.current,
          code:
            error instanceof ReceiptApiError
              ? error.code
              : "unexpected_response",
        });
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(null);
        onBusyChange(false);
      }
    }
  }

  /**
   * Saves the current receipt review, using only a previously confirmed comparison.
   */
  async function save() {
    if (pending.current) return;
    const payload = buildFinalSaveDto(draft);
    if (!payload) return;
    const decision = duplicateReviewDecision(draft, duplicates);
    if (decision.action === "review") return "duplicates" as const;
    const identity = duplicateIdentity(draft);
    return run("save", async (signal) => {
      const result = await confirmReceipt(
        review.scanId,
        payload,
        decision.action === "override",
        signal,
      );
      if (signal.aborted) return;
      if (result.kind === "merchant_selection_required") {
        onMerchantConflict(result.candidates);
        setNotice({
          id: ++sequence.current,
          code: "merchant_selection_required",
        });
        return "merchant_selection_required" as const;
      }
      if (result.kind === "duplicates") {
        setDuplicates({ identity, candidates: result.candidates });
        return "duplicates" as const;
      }
      onSaved(result.receiptId);
      return "saved" as const;
    });
  }

  /**
   * Confirms the duplicate review for the current receipt draft.
   */
  function confirmDuplicates() {
    if (pending.current) return;
    setDuplicates((current) => confirmDuplicateReview(draft, current));
  }
  return {
    candidates,
    duplicatesConfirmed,
    confirmDuplicates,
    busy,
    notice,
    dismissNotice,
    save,
  };
}
