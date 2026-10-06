import { useId } from "react";

/**
 * Inline confirmation component for actions such as deletions.
 * @param title The title of the confirmation prompt.
 * @param message The message providing additional context for the confirmation.
 * @param confirmLabel The label for the confirm button.
 * @param cancelLabel The label for the cancel button.
 * @param onConfirm Callback invoked when the confirm button is clicked.
 * @param onCancel Callback invoked when the cancel button is clicked.
 */
export default function InlineConfirmation({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div
      role="alert"
      aria-labelledby={id}
      className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <h5 id={id} className="text-sm font-semibold">
        {title}
      </h5>
      <p className="text-xs text-muted">{message}</p>
      <div className="flex flex-wrap justify-end gap-3">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="cursor-pointer rounded-lg border border-shell px-3 py-2 text-xs hover:bg-surface-hover"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-surface hover:bg-accent-hover"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
