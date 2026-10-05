import type { ProviderSettingsService } from "../settings/provider-settings-service.js";
import { createReceiptExtractionProvider } from "./create-provider.js";
import type { ReceiptExtractionProvider } from "./receipt-extraction-provider.js";

export type ProviderResolver = (
  selection: unknown,
) => ReceiptExtractionProvider;

export function createProviderResolver(
  settings: ProviderSettingsService,
  factory: typeof createReceiptExtractionProvider = createReceiptExtractionProvider,
): ProviderResolver {
  return (selection) => factory(settings.getProcessingConfiguration(selection));
}
