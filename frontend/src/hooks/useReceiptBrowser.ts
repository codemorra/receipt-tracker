import { useEffect, useRef, useState } from "react";
import {
  getReceipts,
  ReceiptApiError,
  type ReceiptErrorCode,
  type ReceiptList,
} from "../api/receipt-api";

/** Debounces searches, cancels superseded requests and retains rows during loading. */
export function useReceiptBrowser() {
  const [search, setSearchInput] = useState("");
  const [query, setQuery] = useState({ search: "", page: 1, attempt: 0 });
  const [result, setResult] = useState<{
    query: typeof query;
    data: ReceiptList | null;
    error: ReceiptErrorCode | null;
  } | null>(null);
  const lastRequestedSearch = useRef("");
  const loading = result?.query !== query;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        lastRequestedSearch.current = query.search;
        getReceipts(query.search, query.page, controller.signal)
          .then((data) => {
            if (!controller.signal.aborted)
              setResult({ query, data, error: null });
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setResult((previous) => ({
              query,
              data: previous?.data ?? null,
              error:
                error instanceof ReceiptApiError
                  ? error.code
                  : "unexpected_response",
            }));
          });
      },
      query.search === lastRequestedSearch.current ? 0 : 200,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  function setSearch(value: string) {
    setSearchInput(value);
    const normalized = value.trim();
    setQuery((current) =>
      current.search === normalized
        ? current
        : { search: normalized, page: 1, attempt: 0 },
    );
  }
  return {
    search,
    setSearch,
    data: result?.data ?? null,
    loading,
    error: loading ? null : (result?.error ?? null),
    setPage: (page: number) => setQuery((current) => ({ ...current, page })),
    retry: () =>
      setQuery((current) => ({ ...current, attempt: current.attempt + 1 })),
  };
}
