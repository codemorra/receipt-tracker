import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type {
  LookupKind,
  LookupOption,
  ReviewErrorCode,
} from "../../api/review-api";
import { useReviewLookup } from "../../hooks/useReviewLookup";
import Dropdown from "./Dropdown";

// Props for the LookupField component.
interface Props {
  label: string;
  kind: LookupKind;
  selectedId: number | null;
  selectedName: string;
  initialOptions?: LookupOption[];
  optionLabel?: (option: LookupOption) => string;
  onSelect: (option: LookupOption | null) => void;
  onError: (code: ReviewErrorCode) => void;
  footer?: ReactNode;
}

/**
 * Renders a lookup field with a search input and dropdown options.
 * @param label - The label for the lookup field.
 * @param kind - The kind of lookup to perform.
 * @param selectedId - The ID of the currently selected option.
 * @param selectedName - The name of the currently selected option.
 * @param initialOptions - Initial options to display in the dropdown.
 * @param optionLabel - Function to determine the display label for each option.
 * @param onSelect - Callback invoked when an option is selected.
 * @param onError - Callback invoked when an error occurs during lookup.
 * @param footer - Optional footer content to display below the dropdown.
 */
export default function LookupField({
  label,
  kind,
  selectedId,
  selectedName,
  initialOptions = [],
  optionLabel = (option) => option.name,
  onSelect,
  onError,
  footer,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const lookup = useReviewLookup(kind, query, open, onError);
  const choices = initialOptions.filter((option) =>
    optionLabel(option)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  for (const option of lookup.options) {
    const index = choices.findIndex((entry) => entry.id === option.id);
    if (index === -1) choices.push(option);
    else choices[index] = { ...choices[index], ...option };
  }
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <Dropdown
        label={label}
        groupLabel={label}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setQuery("");
        }}
        triggerClassName="flex w-full items-center gap-2 px-3 py-2.5 text-sm"
        panelClassName="w-full min-w-48 p-2"
        trigger={
          <>
            <span className="min-w-0 flex-1 truncate">
              {selectedId === null
                ? t("pages.import.review.lookup.search")
                : selectedName}
            </span>
            <span aria-hidden="true" className="text-muted">
              ⌄
            </span>
          </>
        }
      >
        <input
          type="search"
          aria-label={t("pages.import.review.lookup.search")}
          placeholder={t("pages.import.review.lookup.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mb-2 w-full rounded-lg border border-shell bg-canvas px-3 py-2 text-sm"
        />
        <div className="max-h-60 space-y-1 overflow-y-auto overscroll-contain">
          {choices.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={selectedId === option.id}
              onClick={() => onSelect(option)}
              className="block w-full rounded-lg px-3 py-2.5 text-left text-sm wrap-break-word hover:bg-surface-hover aria-pressed:bg-accent-soft aria-pressed:text-accent"
            >
              {optionLabel(option)}
            </button>
          ))}
          {lookup.loading && (
            <p role="status" className="px-3 py-2 text-xs text-muted">
              {t("pages.import.review.lookup.loading")}
            </p>
          )}
          {!lookup.loading && !lookup.failed && choices.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">
              {t("pages.import.review.lookup.empty")}
            </p>
          )}
          {lookup.failed && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                lookup.retry();
              }}
              className="px-3 py-2 text-xs text-accent underline"
            >
              {t("pages.import.review.lookup.retry")}
            </button>
          )}
        </div>
      </Dropdown>
      {(footer || selectedId !== null) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {footer}
          {selectedId !== null && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="ml-auto cursor-pointer rounded text-xs text-accent underline underline-offset-4"
            >
              {t("pages.import.review.lookup.clear")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
