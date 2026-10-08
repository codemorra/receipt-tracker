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
    "QWEN FINAL EVIDENCE CHECK",
    "For each counted product, recheck whether its purchase quantity has independent evidence: an associated multiplication, an explicit count or a distinct quantity column. A bare digit appended to the monetary amount in the price column is a technical marker, not a purchased count. Without separate purchase-quantity evidence, use quantity 1, unit pcs and unitPriceCents equal to the printed line total; do not make that known price null because of the marker. Preserve explicitly supported multiple purchases and weighed quantities.",
    "For deposit returns, an explicit negative multiplication is quantity evidence and overrides the default quantity 1. Its minus sign expresses the return direction: use the absolute printed count as positive quantity, unit pcs, and the negative printed per-unit price as unitPriceCents. Keep the negative printed line total. Associate a return multiplication before or after the deposit-return line by checking that positive quantity times negative unit price matches its line total. Do not collapse a multi-unit return into quantity 1 with the line total as its unit price.",
    "Preserve a clearly readable product brand's printed spelling in brand and normalizedName; changes of letter case are allowed. Do not insert, remove or replace letters merely to turn an unfamiliar proper name into a familiar word or name. Repair spelling only when receipt evidence supports an actual OCR error; if the brand identity is uncertain, use null rather than a different brand.",
    "QWEN FINAL DISCOUNT CHECK",
    "Before returning JSON, revisit each discount against the final items array. Locate its OCR row, identify the preceding purchased product including that product's quantity/price segments, then look up that product's zero-based item index. Quantity segments on the product row do not break the association with a discount directly below it.",
    "Being the last discount before the amount payable is not evidence of receipt-wide scope. If a discount directly follows the final purchased item without a subtotal or coupon-section boundary or explicit broader scope, associate it with that item. The following total and the absence of another product do not make that association ambiguous.",
    "A loyalty, app or membership-program label describes eligibility, not whether a discount applies to one item or the whole receipt. A matching amount in a later savings summary does not change the scope of the original discount line. Determine the target from that original line's placement and explicit wording: when printed directly below a product, assign it to that product unless the receipt identifies a wider scope. Keep null for receipt-wide or multi-product coupons, or genuinely unresolved targets. Do not use an OCR line index, row index, or discount position as appliesToItemIndex. Return only the JSON object.",
  ].join("\n");
}
