import {
  parseCents,
  type ReviewDraft,
  type DuplicateCandidate,
} from "./review-state.ts";

// Functions and types for handling duplicate review logic in receipt reviews.
export interface DuplicateReview {
  identity: string;
  candidates: DuplicateCandidate[];
  confirmed?: boolean;
}

/**
 * Generates a unique identity string for a receipt draft based on its editable fields.
 */
export function duplicateIdentity(draft: ReviewDraft): string {
  return JSON.stringify([
    draft.merchantId,
    ...(draft.merchantId === null
      ? [draft.merchantName, draft.merchantRawName]
      : []),
    draft.purchaseDate,
    draft.purchaseTime || null,
    parseCents(draft.total),
  ]);
}

/**
 * Determines the appropriate action for a duplicate review based on the current draft and review state.
 * @param draft The current receipt draft.
 * @param review The current duplicate review state.
 * @returns An object containing the filtered candidates and the determined action ("save", "review", or "override").
 */
export function duplicateReviewDecision(
  draft: ReviewDraft,
  review: DuplicateReview,
) {
  const candidates =
    review.identity === duplicateIdentity(draft) ? review.candidates : [];
  const action: "save" | "review" | "override" =
    candidates.length === 0 ? "save" : review.confirmed ? "override" : "review";
  return { candidates, action };
}

/**
 * Confirms the current comparison without saving; stale comparisons grant no override.
 * @param draft The current receipt draft.
 * @param review The current duplicate review state.
 * @returns The updated duplicate review with the confirmed status.
 */
export function confirmDuplicateReview(
  draft: ReviewDraft,
  review: DuplicateReview,
): DuplicateReview {
  return {
    ...review,
    confirmed: duplicateReviewDecision(draft, review).candidates.length > 0,
  };
}
