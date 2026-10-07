import Dropdown from "./Dropdown";

// Option type for the Select component.
interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

// Props for the Select component.
interface Props {
  label: string;
  value: string;
  options: Option[];
  disabled?: boolean;
  floatingPanel?: boolean;
  compact?: boolean;
  fitOptions?: boolean;
  onChange: (value: string) => void;
}

/**
 * Select component renders a dropdown with a list of options.
 * @param label The label for the select dropdown.
 * @param value The currently selected value.
 * @param options The list of available options.
 * @param disabled Whether the select dropdown should be disabled.
 * @param floatingPanel Whether the dropdown panel should float.
 * @param compact Whether the select should use compact styling.
 * @param fitOptions Keep the width based on all labels, including space for the panel's checkmark.
 * @param onChange Callback function to handle when the selected value changes.
 */
export default function Select({
  label,
  value,
  options,
  disabled,
  floatingPanel,
  compact = false,
  fitOptions = false,
  onChange,
}: Props) {
  const selected = options.find((option) => option.value === value);
  return (
    <Dropdown
      className={fitOptions ? "w-max max-w-full" : undefined}
      label={`${label}: ${selected?.label ?? ""}`}
      groupLabel={label}
      disabled={disabled}
      floatingPanel={floatingPanel}
      triggerClassName={`flex w-full items-center gap-3 text-sm text-foreground ${compact ? "px-3 py-2.5" : "px-3.5 py-3"}`}
      panelClassName="w-full min-w-40 p-2"
      trigger={
        <>
          {fitOptions ? (
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)]">
              {/* Reserve the widest option plus the panel's extra padding and checkmark space. */}
              {options.map((option) => (
                <span
                  key={option.value}
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 h-0 overflow-hidden pr-3 whitespace-nowrap"
                >
                  {option.label}
                </span>
              ))}
              <span className="col-start-1 row-start-1 wrap-break-word">
                {selected?.label}
              </span>
            </span>
          ) : (
            <span className="truncate">{selected?.label}</span>
          )}
          <svg
            className="ml-auto shrink-0 text-muted transition-transform group-open/dropdown:rotate-180 motion-reduce:transition-none"
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="m5 8 5 5 5-5" />
          </svg>
        </>
      }
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled || option.disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="group/option flex w-full items-center gap-3 rounded-lg px-2.5 py-3 text-left text-sm hover:bg-surface-hover aria-pressed:bg-(image:--accent-gradient) aria-pressed:text-accent disabled:cursor-default disabled:opacity-50"
        >
          <span
            className={`min-w-0 ${fitOptions ? "wrap-break-word" : "truncate"}`}
          >
            {option.label}
          </span>
          <svg
            className="invisible ml-auto shrink-0 group-aria-pressed/option:visible"
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="m4 10 4 4 8-8" />
          </svg>
        </button>
      ))}
    </Dropdown>
  );
}
