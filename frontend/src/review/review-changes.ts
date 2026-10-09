import type { ReviewDraft } from "./review-state";
import type { ImportAction, ImportState } from "../scans/import-state";

/** Compare with the initial draft, including assignment and warranty edits. */
export function hasReviewChanges(
  original: ReviewDraft,
  draft: ReviewDraft,
): boolean {
  return JSON.stringify(original) !== JSON.stringify(draft);
}

/** Only user actions that replace extracted data need the loss warning. */
export function requiresReviewConfirmation(
  state: Pick<ImportState, "processed">,
  changed: boolean,
  action: ImportAction,
): boolean {
  return (
    Boolean(state.processed) &&
    changed &&
    (action.type === "corners" ||
      action.type === "rotate" ||
      action.type === "receipt-frame" ||
      (action.type === "start" && action.operation === "process"))
  );
}
