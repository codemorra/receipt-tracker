// Extraction profile for the Ollama LLM provider
export const ollamaExtractionProfile = {
  temperature: 0,
  think: true,
  timeoutMs: 240_000,
} as const;

// OpenAI extraction profile tuned for Luna
export const openaiExtractionProfile = {
  reasoningEffort: "none",
  temperature: 0,
  timeoutMs: 240_000,
} as const;
