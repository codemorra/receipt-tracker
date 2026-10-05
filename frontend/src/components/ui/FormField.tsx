import { useId, type ComponentPropsWithoutRef } from "react";
import Select from "./Select";

/**
 * Renders a text input field with a label.
 * @param label - The label for the input field.
 * @param className - Additional CSS classes for the container.
 * @param props - Other props passed to the input element.
 */
export function TextField({
  label,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"input"> & { label: string }) {
  const id = useId();
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <input
        {...props}
        id={id}
        className="w-full min-w-0 rounded-xl border border-shell bg-canvas/40 px-3 py-2.5 text-sm text-foreground transition-colors focus:border-accent disabled:opacity-60"
      />
    </div>
  );
}

/**
 * Renders a select dropdown field with a label.
 * @param props - Props passed to the Select component, including the label.
 */
export function SelectField(props: ComponentPropsWithoutRef<typeof Select>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted">{props.label}</p>
      <Select compact {...props} />
    </div>
  );
}

/**
 * Renders a textarea field with a label.
 * @param label - The label for the textarea field.
 * @param props - Other props passed to the textarea element.
 */
export function TextAreaField({
  label,
  ...props
}: ComponentPropsWithoutRef<"textarea"> & { label: string }) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <textarea
        {...props}
        id={id}
        className="w-full rounded-xl border border-shell bg-canvas/40 px-3 py-2.5 text-sm text-foreground focus:border-accent"
      />
    </div>
  );
}
