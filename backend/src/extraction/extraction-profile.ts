// Extraction profile for the Ollama LLM provider
export const ollamaExtractionProfile = {
  temperature: 0,
  think: true,
  timeoutMs: 240_000,
} as const;

// OpenAI extraction profile tuned for Luna
export const openaiExtractionProfile = {
  reasoningEffort: "none",
  timeoutMs: 240_000,
} as const;

// Mistral extraction profile tuned for Medium
export const mistralExtractionProfile = {
  temperature: 0,
  timeoutMs: 240_000,
  randomSeed: 42,
  responseFormat: "json_schema",
  instructions:
    "Finalize the complete items array before assigning discounts. For each discount independently identify its product in the OCR, then look up that product's zero-based position in the final items array, counting ALL line types (product, deposit, fee, other). Consecutive discounts on the same product must reuse that same item index; their position in discounts is irrelevant. Use null only for receipt-level, multi-product or genuinely ambiguous discounts, not for a second discount on an identifiable product.",
  reasoningEffort: "high",
  topP: 1,
} as const;
