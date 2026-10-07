import { useCallback, useEffect, useRef, type ReactNode } from "react";

// Props for the Dropdown component.
interface Props {
  label: string;
  groupLabel: string;
  title?: string;
  trigger: ReactNode;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  disabled?: boolean;
  floatingPanel?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Dropdown component for rendering a dropdown menu with a trigger and panel.
 * @param label The accessible label for the dropdown trigger.
 * @param groupLabel The accessible label for the dropdown panel group.
 * @param title Optional title for the dropdown trigger.
 * @param trigger The content of the dropdown trigger.
 * @param triggerClassName Additional CSS classes to apply to the trigger element.
 * @param panelClassName Additional CSS classes to apply to the panel element.
 * @param children The content of the dropdown panel.
 */
export default function Dropdown({
  label,
  groupLabel,
  title,
  trigger,
  className = "",
  triggerClassName = "",
  panelClassName = "",
  disabled = false,
  floatingPanel = false,
  onOpenChange,
  children,
}: Props) {
  const dropdown = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const positionPanel = useCallback(() => {
    if (!dropdown.current?.open || !summary.current || !panel.current) return;
    const bounds = summary.current.getBoundingClientRect();
    Object.assign(panel.current.style, {
      left: `${bounds.left}px`,
      top: `${bounds.bottom + 8}px`,
      width: `${bounds.width}px`,
      maxHeight: `${Math.max(80, window.innerHeight - bounds.bottom - 24)}px`,
    });
  }, []);

  useEffect(() => {
    if (!floatingPanel) return;
    window.addEventListener("resize", positionPanel);
    document.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      document.removeEventListener("scroll", positionPanel, true);
    };
  }, [floatingPanel, positionPanel]);
  useEffect(() => {
    if (disabled) dropdown.current?.removeAttribute("open");
  }, [disabled]);

  // Close the dropdown when clicking outside or pressing Escape.
  function close() {
    if (dropdown.current) dropdown.current.open = false;
    summary.current?.focus();
  }

  // Close the dropdown when the component is unmounted.
  useEffect(() => {
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !dropdown.current?.contains(event.target)
      ) {
        dropdown.current?.removeAttribute("open");
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dropdown.current?.open) {
        event.preventDefault();
        if (dropdown.current) dropdown.current.open = false;
        summary.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  return (
    <details
      ref={dropdown}
      className={`group/dropdown relative ${className}`}
      onToggle={() => {
        if (floatingPanel) positionPanel();
        onOpenChange?.(dropdown.current?.open ?? false);
      }}
    >
      <summary
        ref={summary}
        aria-label={label}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        title={title}
        className={`cursor-pointer list-none rounded-xl border border-shell bg-(image:--surface-gradient) shadow-soft hover:border-accent/45 group-open/dropdown:border-accent/45 aria-disabled:cursor-default aria-disabled:opacity-60 [&::-webkit-details-marker]:hidden ${triggerClassName}`}
      >
        {trigger}
      </summary>
      <div
        ref={panel}
        role="group"
        aria-label={groupLabel}
        onClick={(event) => {
          // Action buttons and links select an entry; other panel clicks keep it open.
          if (
            !event.defaultPrevented &&
            event.target instanceof Element &&
            event.target.closest("button:not(:disabled), a[href]")
          )
            close();
        }}
        className={`${floatingPanel ? "fixed overflow-y-auto" : "absolute top-[calc(100%+0.6rem)] right-0"} z-30 origin-top-right rounded-2xl border border-shell bg-(image:--surface-gradient) shadow-raised group-open/dropdown:animate-dropdown-in motion-reduce:animate-none ${panelClassName}`}
      >
        {children}
      </div>
    </details>
  );
}
