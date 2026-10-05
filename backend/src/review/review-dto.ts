import type { Database } from "../db/database.js";
import type { ReceiptExtraction } from "../extraction/receipt-extraction.js";
import {
  matchMerchant,
  type MerchantMatch,
} from "../matching/merchant-matcher.js";
import {
  matchProduct,
  type ProductMatch,
} from "../matching/product-matcher.js";
import {
  findDuplicateCandidates,
  type DuplicateCandidate,
} from "./duplicate-detection.js";
import { checkReceiptSum, type SumCheck } from "./sum-check.js";

// Data transfer object and helper function for creating a review of a receipt, including merchant match, item matches, duplicate detection, and sum check.
export interface ReviewDto {
  scanId: string;
  archiveUrl: string;
  merchant: ReceiptExtraction["merchant"] & { match: MerchantMatch };
  purchaseDate: string | null;
  purchaseTime: string | null;
  currency: string | null;
  totalCents: number | null;
  items: (ReceiptExtraction["items"][number] & {
    match: ProductMatch | null;
  })[];
  discounts: ReceiptExtraction["discounts"];
  duplicateCandidates: DuplicateCandidate[];
  sumCheck: SumCheck;
  warnings: ("possible_duplicate" | "sum_mismatch" | "sum_incomplete")[];
}

/**
 * Creates a review data transfer object (DTO) for a receipt, including merchant match, item matches, duplicate detection, and sum check.
 * @param db The database instance used for matching merchants and products, and finding duplicate candidates.
 * @param scan The scan information containing the scan ID and archive URL.
 * @param extraction The extracted receipt data.
 * @returns A ReviewDto object containing the review details of the receipt.
 */
export function createReviewDto(
  db: Database,
  scan: { scanId: string; archiveUrl: string },
  extraction: ReceiptExtraction,
): ReviewDto {
  const merchantMatch = matchMerchant(
    db,
    extraction.merchant.rawName ?? extraction.merchant.normalizedName,
  );
  const items = extraction.items.map((item) => ({
    ...item,
    match: item.lineType === "product" ? matchProduct(db, item) : null,
  }));
  const duplicateCandidates = findDuplicateCandidates(db, {
    merchantId:
      merchantMatch.status === "MATCHED" ? merchantMatch.merchantId : null,
    purchaseDate: extraction.purchaseDate,
    purchaseTime: extraction.purchaseTime,
    totalCents: extraction.totalCents,
  });
  const sumCheck = checkReceiptSum(extraction);
  const warnings: ReviewDto["warnings"] = [];
  if (duplicateCandidates.length > 0) warnings.push("possible_duplicate");
  if (sumCheck.status === "MISMATCH") warnings.push("sum_mismatch");
  if (sumCheck.status === "INCOMPLETE") warnings.push("sum_incomplete");

  return {
    scanId: scan.scanId,
    archiveUrl: scan.archiveUrl,
    merchant: { ...extraction.merchant, match: merchantMatch },
    purchaseDate: extraction.purchaseDate,
    purchaseTime: extraction.purchaseTime,
    currency: extraction.currency,
    totalCents: extraction.totalCents,
    items,
    discounts: extraction.discounts,
    duplicateCandidates,
    sumCheck,
    warnings,
  };
}
