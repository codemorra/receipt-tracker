import type { Database } from "../db/database.js";
import {
  findMerchantEvidence,
  type MerchantCandidate,
} from "./merchant-evidence.js";

// Interface for the result of a merchant match.
export interface MerchantMatch {
  status: "MATCHED" | "SUGGESTED" | "NEW";
  merchantId: number | null;
  candidates: MerchantCandidate[];
}

/**
 * Matches a merchant based on raw and normalized names, using evidence from aliases and canonical names.
 * @param db - The database connection to use for queries.
 * @param rawName - The raw alias name to look up.
 * @param normalizedName - The normalized canonical name to look up.
 * @returns An object representing the match result, including status, matched merchant ID, and candidate merchants.
 */
export function matchMerchant(
  db: Database,
  rawName: string | null,
  normalizedName: string | null = null,
): MerchantMatch {
  const evidence = findMerchantEvidence(
    db,
    rawName ?? normalizedName,
    normalizedName?.trim() || rawName,
  );
  if (!evidence.conflict && evidence.aliases.length === 1) {
    return {
      status: "MATCHED",
      merchantId: evidence.aliases[0].merchantId,
      candidates: evidence.candidates,
    };
  }
  return {
    status: evidence.candidates.length ? "SUGGESTED" : "NEW",
    merchantId: null,
    candidates: evidence.candidates,
  };
}
