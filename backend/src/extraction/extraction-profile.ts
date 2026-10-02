// Extraction profile for the Ollama LLM provider
export const ollamaExtractionProfile = {
  temperature: 0,
  think: true,
  timeoutMs: 240_000,
} as const;

// Extraction profile for the Mistral LLM provider
export const mistralExtractionProfile = {
  temperature: 0,
  timeoutMs: 240_000,
  responseFormat: "json_schema",
} as const;
