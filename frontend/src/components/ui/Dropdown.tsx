import { useEffect, useRef, type ReactNode } from "react";

// Props for the Dropdown component.
interface Props {
  label: string;
  groupLabel: string;
  title?: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
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
  triggerClassName = "",
  panelClassName = "",
  children,
}: Props) {
  const dropdown = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

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
    <details ref={dropdown} className="group/dropdown relative">
      <summary
        ref={summary}
        aria-label={label}
        title={title}
        className={`cursor-pointer list-none rounded-xl border border-shell bg-(image:--surface-gradient) shadow-soft hover:border-accent/45 group-open/dropdown:border-accent/45 [&::-webkit-details-marker]:hidden ${triggerClassName}`}
      >
        {trigger}
      </summary>
      <div
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
        className={`absolute top-[calc(100%+0.6rem)] right-0 origin-top-right rounded-2xl border border-shell bg-(image:--surface-gradient) shadow-raised group-open/dropdown:animate-dropdown-in motion-reduce:animate-none ${panelClassName}`}
      >
        {children}
      </div>
    </details>
  );
}
