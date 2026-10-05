import type { ComponentPropsWithoutRef } from "react";

/**
 * Card component for rendering a styled section container.
 * @param className Additional CSS classes to apply to the card.
 * @param props Other props to pass to the section element.
 */
export default function Card({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      {...props}
      className={`rounded-2xl border border-shell border-t-accent/20 bg-(image:--surface-gradient) p-8 shadow-soft max-[400px]:p-5 ${className}`}
    />
  );
}
