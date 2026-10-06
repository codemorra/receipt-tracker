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
  open?: boolean;
  placement?: "center" | "right";
  scrollContent?: boolean;
}

// Session information for managing modal focus and body overflow.
interface ModalSession {
  previousFocus: Element | null;
  overflow: string;
}

/**
 * Closes the modal dialog and restores the previous focus and body overflow.
 * @param element The HTMLDialogElement to close.
 * @param session The ModalSession containing the previous focus and body overflow.
 */
function closeDialog(
  element: HTMLDialogElement | null,
  session: ModalSession | null,
) {
  element?.close();
  if (!session) return;
  document.body.style.overflow = session.overflow;
  if (
    session.previousFocus instanceof HTMLElement &&
    session.previousFocus.isConnected
  )
    session.previousFocus.focus({ preventScroll: true });
}

/**
 * Modal component displays a modal dialog with a title and content.
 * @param title The title of the modal dialog.
 * @param onClose Callback function to handle closing the modal.
 * @param busy Whether the modal is in a busy state, preventing it from being closed.
 * @param children The content of the modal dialog.
 * @param className Additional CSS classes to apply to the modal dialog.
 * @param size The size of the modal, either "standard" or "wide".
 * @param open Boolean indicating if the modal is currently open.
 * @param placement Whether to center the dialog or show it as a full-height right panel.
 * @param scrollContent Boolean indicating if the modal content should be scrollable.
 */
export default function Modal({
  title,
  onClose,
  busy = false,
  children,
  className = "",
  size = "standard",
  open = true,
  placement = "center",
  scrollContent = true,
}: Props) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const session = useRef<ModalSession | null>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      delete element.dataset.closing;
      if (!element.open) {
        session.current = {
          previousFocus: document.activeElement,
          overflow: document.body.style.overflow,
        };
        document.body.style.overflow = "hidden";
        element.showModal();
      }
      return;
    }
    if (!element.open) return;
    const finish = () => {
      closeDialog(element, session.current);
      session.current = null;
      delete element.dataset.closing;
    };
    if (
      placement !== "right" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finish();
      return;
    }
    const transform = getComputedStyle(element).transform;
    element.dataset.closing = "true";
    const animation = element.animate(
      [{ transform }, { transform: "translateX(100%)" }],
      { duration: 300, easing: "ease-in-out", fill: "forwards" },
    );
    void animation.finished.then(finish, () => {});
    return () => animation.cancel();
  }, [open, placement]);
  useEffect(() => {
    const element = dialog.current;
    return () => {
      closeDialog(element, session.current);
      session.current = null;
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (open && !busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && open && !busy) onClose();
      }}
      className={`fixed ${
        placement === "right"
          ? `modal-drawer inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full ${size === "wide" ? "max-w-6xl" : "max-w-xl"} rounded-none border-y-0 border-r-0`
          : `m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${size === "wide" ? "max-w-6xl" : "max-w-xl"} rounded-2xl`
      } overflow-hidden border border-shell bg-(image:--surface-gradient) p-0 text-foreground shadow-raised backdrop:bg-black/55 backdrop:backdrop-blur-sm **:focus-visible:outline-2 **:focus-visible:outline-offset-3 **:focus-visible:outline-accent ${className}`}
    >
      <div className={placement === "right" ? "h-full" : "py-4"} inert={!open}>
        <div
          className={`${placement === "right" ? "h-full py-6 sm:py-8" : "max-h-[calc(100dvh-4rem-2px)] py-2 sm:py-4"} ${scrollContent ? "overflow-y-auto overscroll-contain scrollbar-gutter-stable" : "flex flex-col overflow-hidden"} px-6 sm:px-8`}
        >
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
