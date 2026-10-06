import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

// Props for the Modal component.
interface Props {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  className?: string;
  size?: "standard" | "wide";
}

/**
 * Modal component displays a modal dialog with a title and content.
 * @param title The title of the modal dialog.
 * @param onClose Callback function to handle closing the modal.
 * @param busy Whether the modal is in a busy state, preventing it from being closed.
 * @param children The content of the modal dialog.
 * @param className Additional CSS classes to apply to the modal dialog.
 * @param size The size of the modal, either "standard" or "wide".
 */
export default function Modal({
  title,
  onClose,
  busy = false,
  children,
  className = "",
  size = "standard",
}: Props) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className={`fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${size === "wide" ? "max-w-6xl" : "max-w-xl"} overflow-hidden rounded-2xl border border-shell bg-(image:--surface-gradient) p-0 text-foreground shadow-raised backdrop:bg-black/55 backdrop:backdrop-blur-sm **:focus-visible:outline-2 **:focus-visible:outline-offset-3 **:focus-visible:outline-accent ${className}`}
    >
      <div className="py-4">
        <div className="max-h-[calc(100dvh-4rem-2px)] overflow-y-auto overscroll-contain px-6 py-2 sm:px-8 sm:py-4">
          <header className="flex items-start justify-between gap-4">
            <h2
              id={`${id}-title`}
              tabIndex={-1}
              autoFocus
              className="text-xl font-semibold tracking-tight"
            >
              {title}
            </h2>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label={t("common.actions.closeDialog")}
              className="shrink-0 cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-hover hover:text-foreground disabled:cursor-default disabled:opacity-50"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          {children}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
