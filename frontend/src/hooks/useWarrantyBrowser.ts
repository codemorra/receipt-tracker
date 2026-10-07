import { useEffect, useRef, useState } from "react";
import {
  getWarranties,
  WarrantyApiError,
  type WarrantyErrorCode,
  type WarrantyList,
  type WarrantyStatus,
} from "../api/warranty-api";
import type { WarrantyType } from "../review/review-state";

/**
 * Custom hook for browsing warranties with search, filters, pagination, and retry capabilities.
 * @returns An object containing the current search, filters, pagination state, and methods to update them.
 */
export function useWarrantyBrowser() {
  const [search, setSearchInput] = useState("");
  const [query, setQuery] = useState({
    search: "",
    status: "" as WarrantyStatus | "",
    type: "" as WarrantyType | "",
    page: 1,
    attempt: 0,
  });
  const [result, setResult] = useState<{
    query: typeof query;
    data: WarrantyList | null;
    error: WarrantyErrorCode | null;
  } | null>(null);
  const lastRequestedSearch = useRef("");
  const loading = result?.query !== query;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        lastRequestedSearch.current = query.search;
        getWarranties(
          {
            search: query.search,
            status: query.status || undefined,
            type: query.type || undefined,
            page: query.page,
          },
          controller.signal,
        )
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
                error instanceof WarrantyApiError
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
        : { ...current, search: normalized, page: 1, attempt: 0 },
    );
  }
  return {
    search,
    setSearch,
    status: query.status,
    type: query.type,
    setStatus: (status: WarrantyStatus | "") =>
      setQuery((current) =>
        current.status === status
          ? current
          : { ...current, status, page: 1, attempt: 0 },
      ),
    setType: (type: WarrantyType | "") =>
      setQuery((current) =>
        current.type === type
          ? current
          : { ...current, type, page: 1, attempt: 0 },
      ),
    data: result?.data ?? null,
    loading,
    error: loading ? null : (result?.error ?? null),
    setPage: (page: number) => setQuery((current) => ({ ...current, page })),
    retry: () =>
      setQuery((current) => ({ ...current, attempt: current.attempt + 1 })),
  };
}
