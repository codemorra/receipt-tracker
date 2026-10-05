import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Props for the Modal component.
interface Props {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Modal component displays a modal dialog with a title and content.
 * @param title The title of the modal dialog.
 * @param onClose Callback function to handle closing the modal.
 * @param busy Whether the modal is in a busy state, preventing it from being closed.
 * @param children The content of the modal dialog.
 * @param className Additional CSS classes to apply to the modal dialog.
 */
export default function Modal({
  title,
  onClose,
  busy = false,
  children,
  className = "",
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
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
      className={`fixed m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-shell bg-(image:--surface-gradient) p-0 text-foreground shadow-raised backdrop:bg-black/55 backdrop:backdrop-blur-sm **:focus-visible:outline-2 **:focus-visible:outline-offset-3 **:focus-visible:outline-accent ${className}`}
    >
      <div className="p-6 sm:p-8">
        <h2
          id={`${id}-title`}
          tabIndex={-1}
          autoFocus
          className="text-xl font-semibold tracking-tight"
        >
          {title}
        </h2>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
