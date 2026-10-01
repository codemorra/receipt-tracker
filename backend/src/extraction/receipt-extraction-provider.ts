import type { OcrLine, OcrRow } from "../worker/python-worker-client.js";

// Defines the interfaces for receipt extraction input and provider.
export interface ReceiptExtractionInput {
  plainText: string;
  lines: readonly Pick<OcrLine, "index" | "text">[];
  rows: readonly OcrRow[];
  categoryNames: readonly string[];
}

// Defines the structure of diagnostic information provided by the Ollama LLM during receipt extraction.
export interface OllamaDiagnostics {
  model: string;
  totalDurationMs?: number;
  loadDurationMs?: number;
  promptEvalCount?: number;
  promptEvalDurationMs?: number;
  evalCount?: number;
  evalDurationMs?: number;
}

// Defines the interface for a receipt extraction provider.
export interface ReceiptExtractionProvider {
  extractReceipt(
    input: ReceiptExtractionInput,
    onDiagnostics?: (diagnostics: OllamaDiagnostics) => void,
  ): Promise<unknown>;
}
