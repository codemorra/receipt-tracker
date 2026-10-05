import type { Ref } from "react";

// Props for the PageHeader component.
interface Props {
  title: string;
  description: string;
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * PageHeader component for rendering a page header with a title and description.
 * @param title The title of the page header.
 * @param description The description of the page header.
 * @param headingRef Optional ref for the heading element.
 */
export default function PageHeader({ title, description, headingRef }: Props) {
  return (
    <header className="mb-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl font-semibold tracking-tight"
      >
        {title}
      </h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-muted">{description}</p>
    </header>
  );
}
