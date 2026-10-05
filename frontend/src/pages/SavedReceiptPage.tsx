import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSavedReceipt } from "../hooks/useSavedReceipt";
import SavedReceiptSummary from "../components/receipts/SavedReceiptSummary";
import ReceiptArchiveImage from "../components/receipts/ReceiptArchiveImage";
import Card from "../components/ui/Card";
import PageHeader from "../components/ui/PageHeader";
import Toast from "../components/ui/Toast";

/**
 * Page component for displaying a saved receipt.
 * @param receiptId - The ID of the receipt to display.
 * @param onNewImport - Callback function to trigger a new import.
 */
export default function SavedReceiptPage({
  receiptId,
  onNewImport,
}: {
  receiptId: number;
  onNewImport: () => void;
}) {
  const { t } = useTranslation();
  const saved = useSavedReceipt(receiptId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.import.saved.title", { id: receiptId })} · ${t("common.appName")}`;
  }, [t, receiptId]);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title={t("pages.import.saved.title", { id: receiptId })}
          description={t("pages.import.saved.description")}
          headingRef={heading}
        />
        <button
          type="button"
          onClick={onNewImport}
          className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover"
        >
          {t("pages.import.saved.newImport")}
        </button>
      </div>
      {saved.notice && (
        <Toast
          key={saved.attempt}
          tone="error"
          message={t(`pages.import.save.errors.${saved.notice}`)}
          onDismiss={saved.dismissNotice}
        />
      )}
      {saved.receipt ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <Card className="min-w-0 p-5 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold">
              {t("pages.import.saved.archive")}
            </h2>
            <ReceiptArchiveImage
              url={saved.receipt.imageUrl}
              alt={t("pages.import.saved.imageAlt")}
            />
          </Card>
          <SavedReceiptSummary receipt={saved.receipt} />
        </div>
      ) : (
        <Card aria-busy={!saved.error}>
          <p role="status" className="text-sm text-muted">
            {t(
              saved.error
                ? "pages.import.saved.unavailable"
                : "pages.import.saved.loading",
            )}
          </p>
          {saved.error && (
            <button
              type="button"
              onClick={saved.retry}
              className="mt-4 cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover"
            >
              {t("pages.import.saved.retry")}
            </button>
          )}
        </Card>
      )}
    </>
  );
}
