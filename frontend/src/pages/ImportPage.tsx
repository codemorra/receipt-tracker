import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId } from "../api/provider-settings-api";
import ScanPanel from "../components/import/ScanPanel";
import ReceiptReviewPanel from "../components/import/ReceiptReviewPanel";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import Toast from "../components/ui/Toast";
import { useProviderSettings } from "../hooks/useProviderSettings";
import { useReceiptImport } from "../hooks/useReceiptImport";
import { resolveImportProvider } from "../scans/import-state";

/**
 * Page component for importing receipts.
 * @returns The import page JSX element.
 */
export default function ImportPage({
  onSaved,
}: {
  onSaved: (id: number) => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const workflow = useReceiptImport();
  const [confirming, setConfirming] = useState(false);
  const providers = useProviderSettings();
  const [selection, setSelection] = useState<ProviderId | null | undefined>(
    undefined,
  );
  const provider = resolveImportProvider(providers.settings, selection);
  const notice = workflow.notice
    ? {
        id: `scan-${workflow.notice.id}`,
        message: t(`pages.import.errors.${workflow.notice.code}`),
      }
    : providers.notice?.kind === "error"
      ? {
          id: `provider-${providers.notice.id}`,
          message: t(`providerSettings.errors.${providers.notice.code}`),
        }
      : null;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.import.title")} · ${t("common.appName")}`;
  }, [t]);
  return (
    <>
      <PageHeader
        title={t("pages.import.title")}
        description={t("pages.import.description")}
        headingRef={heading}
      />
      {notice && (
        <Toast
          key={notice.id}
          message={notice.message}
          tone="error"
          onDismiss={
            workflow.notice ? workflow.dismissNotice : providers.dismissNotice
          }
        />
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <ScanPanel
          key={workflow.state.scan?.scanId ?? "upload"}
          state={workflow.state}
          locked={confirming}
          settings={providers.settings}
          provider={provider}
          loadingProviders={providers.loading}
          onProvider={setSelection}
          dispatch={workflow.dispatch}
          onSelectFile={workflow.selectFile}
          onUpload={() => {
            void workflow.upload();
          }}
          onProcess={(provider) => {
            void workflow.process(provider);
          }}
          onError={workflow.reportError}
        />
        {workflow.state.processed ? (
          <ReceiptReviewPanel
            key={`${workflow.state.scan?.scanId}-${workflow.state.generation}`}
            review={workflow.state.processed.review}
            onSaved={onSaved}
            onCancelled={() => workflow.dispatch({ type: "reset" })}
            onBusyChange={setConfirming}
          />
        ) : (
          <Card aria-labelledby="import-review-heading" className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="import-review-heading" className="text-lg font-semibold">
                {t("pages.import.review.title")}
              </h2>
              <span
                role="status"
                className="rounded-lg border border-accent/20 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent"
              >
                {workflow.state.busy === "process"
                  ? t("pages.import.scan.processing")
                  : t("pages.import.review.waiting")}
              </span>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-muted">
              {t("pages.import.review.hint")}
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
