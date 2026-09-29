import type { OcrLine } from "../worker/python-worker-client.js";

// Defines the interfaces for receipt extraction input and provider.
export interface ReceiptExtractionInput {
  plainText: string;
  lines: readonly Pick<OcrLine, "index" | "text">[];
  categoryNames: readonly string[];
}

// Defines the interface for a receipt extraction provider.
export interface ReceiptExtractionProvider {
  extractReceipt(input: ReceiptExtractionInput): Promise<unknown>;
}
