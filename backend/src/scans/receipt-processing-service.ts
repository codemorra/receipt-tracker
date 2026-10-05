import type { Database } from "../db/database.js";
import { errorType, type Logger } from "../logger.js";
import { loadExtractionReferenceData } from "../extraction/extraction-reference-data.js";
import {
  LlmRequestError,
  LlmUnavailableError,
} from "../extraction/extraction-errors.js";
import type { ProviderResolver } from "../extraction/provider-resolver.js";
import type { ReceiptExtractionDiagnostics } from "../extraction/receipt-extraction-provider.js";
import { createReceiptExtractionSchema } from "../extraction/receipt-extraction.js";
import { createReviewDto } from "../review/review-dto.js";
import type { ScanSessionService } from "./scan-session-service.js";
import { isScanId } from "./scan-validation.js";

/** Coordinates OCR, the selected provider, extraction validation and the editable review. */
export class ReceiptProcessingService {
  constructor(
    private readonly scans: ScanSessionService,
    private readonly db: Database,
    private readonly resolveProvider: ProviderResolver,
    private readonly logger: Logger,
  ) {}

  // Processes a receipt scan through OCR, LLM extraction, and review generation.
  async process(
    scanId: string,
    input: { corners: unknown; rotation?: unknown; provider?: unknown },
  ) {
    if (!isScanId(scanId)) return undefined;
    const loggedScanId = scanId;
    const processingStarted = performance.now();
    let stage = "provider";
    let llmStarted: number | undefined;
    this.logger("info", "scan.process.start", {
      scanId: loggedScanId,
    });
    let workerStarted: number | undefined;
    try {
      const provider = this.resolveProvider(input.provider);
      stage = "worker";
      workerStarted = performance.now();
      this.logger("info", "scan.worker.start", { scanId: loggedScanId });
      const result = await this.scans.process(
        scanId,
        input.corners,
        input.rotation,
      );
      if (!result) {
        return undefined;
      }
      const workerDurationMs = performance.now() - workerStarted;
      this.logger("info", "scan.ocr.complete", {
        scanId: result.scanId,
        ocrDurationMs: result.ocrDurationMs,
        workerDurationMs,
      });
      stage = "reference_data";
      const { categoryNames } = loadExtractionReferenceData(this.db);
      stage = "llm";
      let llm: ReceiptExtractionDiagnostics | undefined;
      this.logger("info", "scan.llm.start", { scanId: result.scanId });
      llmStarted = performance.now();
      const extracted = await provider.extractReceipt(
        {
          plainText: result.plainText,
          lines: result.lines,
          rows: result.rows,
          categoryNames,
        },
        (diagnostics) => {
          llm = diagnostics;
        },
      );
      const llmDurationMs = performance.now() - llmStarted;
      this.logger("info", "scan.llm.complete", {
        scanId: result.scanId,
        durationMs: llmDurationMs,
        provider: llm?.provider,
        model: llm?.model,
        inputTokens: llm?.inputTokens,
        outputTokens: llm?.outputTokens,
        totalTokens: llm?.totalTokens,
        ollamaTotalDurationMs: llm?.ollama?.totalDurationMs,
        loadDurationMs: llm?.ollama?.loadDurationMs,
        promptEvalCount: llm?.ollama?.promptEvalCount,
        promptEvalDurationMs: llm?.ollama?.promptEvalDurationMs,
        evalCount: llm?.ollama?.evalCount,
        evalDurationMs: llm?.ollama?.evalDurationMs,
      });
      stage = "review";
      const extraction = createReceiptExtractionSchema(
        categoryNames,
        result.lines.map((line) => line.index),
      ).parse(extracted);
      const review = createReviewDto(this.db, result, extraction);
      const totalDurationMs = performance.now() - processingStarted;
      this.logger("info", "scan.process.complete", {
        scanId: result.scanId,
        durationMs: totalDurationMs,
        ocrDurationMs: result.ocrDurationMs,
        llmDurationMs,
        workerDurationMs,
      });
      return {
        ...result,
        review,
        timings: {
          ocrDurationMs: result.ocrDurationMs,
          workerDurationMs,
          llmDurationMs,
          totalDurationMs,
          llm,
          ollama: llm?.ollama,
        },
      };
    } catch (error) {
      if (stage === "worker" && workerStarted !== undefined) {
        this.logger("error", "scan.worker.failed", {
          scanId: loggedScanId,
          durationMs: performance.now() - workerStarted,
          errorType: errorType(error),
        });
      }
      if (stage === "llm" && llmStarted !== undefined) {
        this.logger("error", "scan.llm.failed", {
          scanId: loggedScanId,
          durationMs: performance.now() - llmStarted,
          errorType: errorType(error),
          provider:
            error instanceof LlmUnavailableError ||
            error instanceof LlmRequestError
              ? error.provider
              : undefined,
          httpStatus:
            error instanceof LlmRequestError ? error.httpStatus : undefined,
        });
      }
      this.logger("error", "scan.process.failed", {
        scanId: loggedScanId,
        stage,
        durationMs: performance.now() - processingStarted,
        errorType: errorType(error),
      });
      throw error;
    }
  }
}
