import type { ReceiptExtractionProviderName } from "./receipt-extraction-provider.js";

// General LLM errors
export class LlmUnavailableError extends Error {
  constructor(
    readonly provider: ReceiptExtractionProviderName,
    message: string,
  ) {
    super(message);
  }
}

// Errors related to LLM requests
export class LlmRequestError extends Error {
  constructor(
    readonly provider: ReceiptExtractionProviderName,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

// Errors related to the Ollama LLM provider
export class OllamaUnavailableError extends LlmUnavailableError {
  constructor(message: string) {
    super("ollama", message);
  }
}

// Errors related to the Ollama LLM requests
export class OllamaRequestError extends LlmRequestError {
  constructor(message: string, httpStatus?: number) {
    super("ollama", message, httpStatus);
  }
}

export class InvalidLlmResponseError extends Error {}
