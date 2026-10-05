import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface Props {
  message: string;
  tone?: "success" | "error";
  onDismiss: () => void;
}

export default function Toast({ message, tone = "success", onDismiss }: Props) {
  const { t } = useTranslation();
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = popup.current;
    element?.showPopover();
    const timeout = window.setTimeout(
      onDismiss,
      tone === "error" ? 8000 : 3500,
    );
    return () => {
      window.clearTimeout(timeout);
      if (element?.isConnected && element.matches(":popover-open"))
        element.hidePopover();
    };
  }, [onDismiss, tone]);

  // Keep notifications accessible while a native modal makes the rest of the page inert.
  const target =
    tone === "error"
      ? (document.querySelector("dialog[open]") ?? document.body)
      : document.body;
  return createPortal(
    <div
      ref={popup}
      popover="manual"
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className="fixed inset-auto top-5 left-1/2 m-0 flex w-max max-w-[calc(100%_-_2rem)] -translate-x-1/2 animate-dropdown-in items-start gap-3 rounded-2xl border border-shell border-t-accent/40 bg-(image:--surface-gradient) px-5 py-4 text-foreground shadow-raised motion-reduce:animate-none"
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
      >
        {tone === "success" ? "✓" : "!"}
      </span>
      <p className="max-w-xl text-sm leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("common.actions.dismissNotification")}
        className="-mr-1 rounded-lg p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
    </div>,
    target,
  );
}
