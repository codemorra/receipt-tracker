import type { Accent } from "../../appearance/appearance";

// Swatch colors for accent selection
const swatchColors = {
  blue: "bg-[var(--swatch-blue)]",
  green: "bg-[var(--swatch-green)]",
  purple: "bg-[var(--swatch-purple)]",
  orange: "bg-[var(--swatch-orange)]",
};
const swatchStyle = "block size-4 rounded-full shadow-sm ring-1 ring-black/10";

// Props for the ColorSwatch component.
interface Props {
  accent: Accent;
  className?: string;
}

/**
 * ColorSwatch component for displaying a color swatch based on the selected accent.
 * @param accent The currently selected accent color.
 * @param className Optional additional class names for styling.
 */
export default function ColorSwatch({ accent, className = "" }: Props) {
  return (
    <span
      className={`${swatchStyle} ${swatchColors[accent]} ${className}`}
      aria-hidden="true"
    />
  );
}
