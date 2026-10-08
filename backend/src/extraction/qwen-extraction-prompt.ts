import { createReceiptExtractionPrompt } from "./receipt-extraction-prompt.js";
import type { ReceiptExtractionInput } from "./receipt-extraction-provider.js";

/**
 * Adds Qwen-specific checks without changing the shared extraction prompt.
 * @param input The receipt extraction input containing the receipt data and category names.
 * @returns A string containing the Qwen-specific extraction prompt.
 */
export function createQwenReceiptExtractionPrompt(
  input: ReceiptExtractionInput,
): string {
  return [
    createReceiptExtractionPrompt(input),
    "",
    "QWEN FINAL DISCOUNT CHECK",
    "Before returning JSON, revisit each discount against the final items array. Locate its OCR row, identify the preceding purchased product including that product's quantity/price segments, then look up that product's zero-based item index. Quantity segments on the product row do not break the association with a discount directly below it.",
    "A loyalty, app or membership-program label describes eligibility, not whether a discount applies to one item or the whole receipt. A matching amount in a later savings summary does not change the scope of the original discount line. Determine the target from that original line's placement and explicit wording: when printed directly below a product, assign it to that product unless the receipt identifies a wider scope. Keep null for receipt-wide or multi-product coupons, or genuinely unresolved targets. Do not use an OCR line index, row index, or discount position as appliesToItemIndex. Return only the JSON object.",
  ].join("\n");
}
