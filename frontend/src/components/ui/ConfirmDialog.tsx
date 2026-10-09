import Modal from "./Modal";

// Props for the ConfirmDialog component.
interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Renders a confirmation dialog with a title, message, and confirm/cancel buttons.
 * @param title - The title of the dialog.
 * @param message - The message displayed in the dialog.
 * @param confirmLabel - The label for the confirm button.
 * @param cancelLabel - The label for the cancel button.
 * @param busy - Indicates whether the dialog is in a busy state.
 * @param onConfirm - The callback invoked when the confirm button is clicked.
 * @param onCancel - The callback invoked when the cancel button is clicked.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel} busy={busy}>
      <p className="mt-5 text-sm text-muted">{message}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm text-muted hover:bg-surface-hover disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-50"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
