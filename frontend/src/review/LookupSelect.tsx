import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

// A generic lookup select component for fetching and selecting options from an API endpoint.
export interface LookupOption {
  id: number;
  name: string;
}

// Props for the LookupSelect component.
interface Props<T extends LookupOption> {
  label: string;
  selectedLabel: string;
  endpoint: string;
  selectedId: number | null;
  initialOptions?: T[];
  optionLabel?: (option: T) => string;
  onSelect: (option: T | null) => void;
}

// The LookupSelect component itself.
function LookupSelect<T extends LookupOption>({
  label,
  selectedLabel,
  endpoint,
  selectedId,
  initialOptions = [],
  optionLabel = (option) => option.name,
  onSelect,
}: Props<T>) {
  const { t } = useTranslation();
  const id = useId();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [selectedOption, setSelectedOption] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);

  // Use effect to fetch options from the API based on the query.
  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Lookup failed");
        return response.json() as Promise<T[]>;
      })
      .then((results) => {
        setOptions(results);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [endpoint, query]);

  // Combine initial options, selected option, and fetched options into a single list of choices.
  const choices = [...initialOptions];
  if (
    selectedOption &&
    !choices.some((choice) => choice.id === selectedOption.id)
  )
    choices.push(selectedOption);
  for (const option of options) {
    if (!choices.some((choice) => choice.id === option.id))
      choices.push(option);
  }
  const selected = choices.find((option) => option.id === selectedId);
  const suggestions = query.trim()
    ? choices.filter((option) =>
        optionLabel(option)
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
    : selectedId === null
      ? initialOptions
      : [];

  // Function to handle selecting an option.
  function select(option: T | null) {
    setSelectedOption(option);
    setQuery("");
    setOptions([]);
    setFailed(false);
    onSelect(option);
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setFailed(false);
          if (!event.target.value.trim()) setOptions([]);
        }}
        placeholder={t("review.search")}
        className="w-full rounded-lg border border-slate-300 px-3 py-2"
      />
      {selectedId !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 p-2 text-sm">
          <span>
            {selectedLabel}: {selected ? optionLabel(selected) : selectedId}
          </span>
          <button
            type="button"
            onClick={() => select(null)}
            className="font-medium text-emerald-800 underline"
          >
            {t("review.clearSelection")}
          </button>
        </div>
      )}
      {suggestions.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-slate-300 bg-white">
          {suggestions.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => select(option)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100"
              >
                {optionLabel(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {t("review.lookupError")}
        </p>
      )}
    </div>
  );
}

export default LookupSelect;
