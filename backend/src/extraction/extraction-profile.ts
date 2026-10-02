// Extraction profile for the Ollama LLM provider
export const ollamaExtractionProfile = {
  temperature: 0,
  think: true,
  timeoutMs: 240_000,
} as const;

// Extraction profile for the OpenAI LLM provider
export const openaiExtractionProfile = {
  timeoutMs: 240_000,
} as const;

// Common extraction settings for Mistral models
const mistralExtractionSettings = {
  temperature: 0,
  timeoutMs: 240_000,
  randomSeed: 42,
  responseFormat: "json_schema",
} as const;

// Extraction profile for the Ministral 14B model
export const ministral14bExtractionProfile = {
  ...mistralExtractionSettings,
  instructions: [
    "Prefer the printed local checkout date/time over technical TSE/UTC timestamps. Example: 14.09.26 means purchaseDate 2026-09-14.",
    "An explicit purchase multiplication takes precedence over quantity 1: 3,29 x 3 = 9,87 means quantity 3, unit pcs, unitPriceCents 329, totalPriceCents 987. Never use its count as packageAmount.",
    "packageAmount describes only the intrinsic contents of ONE sale unit explicitly supported by the receipt: Eier 10er gives packageAmount 10/packageUnit pcs, 500 g gives 500/g, 1 l gives 1/l. A purchase multiplication alone never supports packageAmount; use null without separate package evidence. Eier 10er has quantity 1 and unit pcs unless a purchase multiplication says otherwise.",
    "Pfand is a positive additional charge unless its printed price is negative. Pfandrückgabe is negative. Never negate a positive printed deposit price.",
    "For ordinary countable items use unit pcs; default quantity to 1 only when no purchase multiplication or other explicit purchase quantity is present.",
    "appliesToItemIndex is the zero-based index in the COMPLETE items array. Count ALL line types: product, deposit, fee, other; never count products only. If items[10] is Pfand and items[11] is Haselnüsse, a Haselnüsse discount must use appliesToItemIndex 11.",
    "Keep normalizedName in the receipt's language: Pfand and Pfandrückgabe stay German. Remove package sizes from normalizedName when represented by packageAmount/packageUnit.",
    "Set productGroup only when a simple generic product type is clearly supported by the product name; otherwise use null. Do not invent groups.",
  ].join("\n"),
} as const;

// Extraction profile for the Mistral Small model
export const mistralSmallExtractionProfile = {
  ...mistralExtractionSettings,
  instructions: [
    "Finalize the complete items array, including deposits and negative deposit returns, before resolving discounts. Never omit a printed deposit return.",
    "For EACH discount independently identify its product from the OCR, then LOOK UP that product's zero-based index in the final items array. The discount's position in the discounts array is irrelevant. Consecutive discounts may share the same preceding item: items A, B, C with discounts for A, A, B, C must reference 0, 0, 1, 2, never 0, 1, 2, 3.",
    "Internally verify every non-null discount reference is less than items.length and points to its actual product. Recheck the product lookup rather than replacing an invalid index with null; null is for receipt-level or genuinely ambiguous discounts.",
    "Use packageAmount/packageUnit only for intrinsic package contents explicitly printed on the receipt. A price or purchase multiplication is not package content; do not assume bottle volumes or turn deposit prices into package sizes.",
  ].join("\n"),
} as const;

// Extraction profile for the Mistral Medium model
export const mistralMediumExtractionProfile = {
  ...mistralExtractionSettings,
  instructions:
    "Finalize the complete items array before assigning discounts. For each discount independently identify its product in the OCR, then look up that product's zero-based position in the final items array, counting ALL line types (product, deposit, fee, other). Consecutive discounts on the same product must reuse that same item index; their position in discounts is irrelevant. Use null only for receipt-level, multi-product or genuinely ambiguous discounts, not for a second discount on an identifiable product.",
  reasoningEffort: "high",
  topP: 1,
} as const;

// Returns the appropriate extraction profile based on the model name.
export function getMistralExtractionProfile(model: string) {
  if (model === "mistral-medium-latest") return mistralMediumExtractionProfile;
  return model === "mistral-small-2603"
    ? mistralSmallExtractionProfile
    : ministral14bExtractionProfile;
}
