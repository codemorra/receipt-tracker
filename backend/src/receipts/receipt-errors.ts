import type { DuplicateCandidate } from "./duplicate-detection.js";
import type { MerchantCandidate } from "../matching/merchant-evidence.js";

export class MerchantSelectionRequiredError extends Error {
  constructor(readonly candidates: MerchantCandidate[]) {
    super("Merchant evidence requires an explicit selection");
  }
}

export class ConfirmedEntityNotFoundError extends Error {}
export class ScanArchiveNotFoundError extends Error {}
export class DuplicateConfirmationRequiredError extends Error {
  constructor(readonly candidates: DuplicateCandidate[]) {
    super("Possible duplicate requires an explicit import decision");
  }
}
