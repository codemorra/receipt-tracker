import type { DuplicateCandidate } from "./duplicate-detection.js";

export class ConfirmedEntityNotFoundError extends Error {}
export class ScanArchiveNotFoundError extends Error {}
export class DuplicateConfirmationRequiredError extends Error {
  constructor(readonly candidates: DuplicateCandidate[]) {
    super("Possible duplicate requires an explicit import decision");
  }
}
