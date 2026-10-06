import { useTranslation } from "react-i18next";
import { useSavedReceipt } from "../../hooks/useSavedReceipt";
import Modal from "../ui/Modal";
import ReceiptDetail from "./ReceiptDetail";

/**
 * Loader component for displaying receipt details within a modal.
 * @param receiptId The ID of the receipt to load and display.
 */
function ReceiptDetailLoader({ receiptId }: { receiptId: number }) {
  const { t } = useTranslation();
  const saved = useSavedReceipt(receiptId);
  return saved.receipt ? (
    <ReceiptDetail receipt={saved.receipt} panel />
  ) : (
    <div
      className="min-h-64 rounded-xl border border-shell p-5"
      aria-busy={!saved.error}
    >
      <p role={saved.error ? "alert" : "status"} className="text-sm text-muted">
        {t(
          saved.error
            ? "pages.receiptDetail.unavailable"
            : "pages.receiptDetail.loading",
        )}
      </p>
      {saved.error && (
        <button
          type="button"
          onClick={saved.retry}
          className="mt-4 cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover"
        >
          {t("pages.receiptDetail.retry")}
        </button>
      )}
    </div>
  );
}

/**
 * Modal component for displaying receipt details.
 * @param receiptId The ID of the receipt to display.
 * @param onClose Callback function to close the modal.
 * @param open Boolean indicating if the modal is currently open.
 */
export default function ReceiptDetailModal({
  receiptId,
  onClose,
  open,
}: {
  receiptId: number;
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      placement="right"
      scrollContent={false}
      title={t("pages.receiptDetail.title", { id: receiptId })}
      size="wide"
      onClose={onClose}
    >
      <div className="mt-6 min-h-0 flex-1">
        <ReceiptDetailLoader key={receiptId} receiptId={receiptId} />
      </div>
    </Modal>
  );
}
