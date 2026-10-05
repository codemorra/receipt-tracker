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
  onChange: (value: string) => void;
}

/**
 * Select component renders a dropdown with a list of options.
 * @param label The label for the select dropdown.
 * @param value The currently selected value.
 * @param options The list of available options.
 * @param disabled Whether the select dropdown should be disabled.
 * @param onChange Callback function to handle when the selected value changes.
 */
export default function Select({
  label,
  value,
  options,
  disabled,
  floatingPanel,
  onChange,
}: Props) {
  const selected = options.find((option) => option.value === value);
  return (
    <Dropdown
      label={`${label}: ${selected?.label ?? ""}`}
      groupLabel={label}
      disabled={disabled}
      floatingPanel={floatingPanel}
      triggerClassName="flex w-full items-center gap-3 px-3.5 py-3 text-sm text-foreground"
      panelClassName="w-full min-w-40 p-2"
      trigger={
        <>
          <span className="truncate">{selected?.label}</span>
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
          <span className="min-w-0 truncate">{option.label}</span>
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
