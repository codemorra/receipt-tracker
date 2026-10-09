import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImportGuard } from "../routes/navigation-guard";
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
  registerGuard,
  onDiscard,
}: {
  onSaved: (id: number) => void;
  registerGuard: (guard: ImportGuard | null) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const workflow = useReceiptImport();
  const [confirming, setConfirming] = useState(false);
  const saving = useRef(false);
  const current = useRef(workflow);
  useLayoutEffect(() => {
    current.current = workflow;
  });
  useLayoutEffect(() => {
    registerGuard({
      active: () =>
        Boolean(current.current.state.file || current.current.state.scan),
      busy: () => saving.current || current.current.discarding,
      discard: () => current.current.discard(),
    });
    return () => registerGuard(null);
  }, [registerGuard]);
  function onBusyChange(busy: boolean) {
    saving.current = busy;
    setConfirming(busy);
  }
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={t("pages.import.title")}
          description={t("pages.import.description")}
          headingRef={heading}
        />
        {(workflow.state.file || workflow.state.scan) && (
          <button
            type="button"
            disabled={confirming || workflow.discarding}
            onClick={onDiscard}
            className="rounded-xl border border-shell px-4 py-2.5 text-sm text-muted hover:bg-surface-hover disabled:opacity-50"
          >
            {t(
              workflow.discarding
                ? "pages.import.discard.discarding"
                : "pages.import.discard.action",
            )}
          </button>
        )}
      </div>
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
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <ScanPanel
          key={workflow.state.scan?.scanId ?? "upload"}
          state={workflow.state}
          locked={confirming || workflow.discarding}
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
            onDiscard={onDiscard}
            locked={workflow.discarding}
            onBusyChange={onBusyChange}
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
