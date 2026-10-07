import type { ReactNode } from "react";

// Interface definition for a column in the PaginatedTable component.
interface Column<Row> {
  key: string;
  label: string;
  align?: "right";
  className?: string;
  render: (row: Row) => ReactNode;
}

// Interface definition for the props of the PaginatedTable component.
interface Props<Row> {
  data: {
    items: Row[];
    page: number;
    totalPages: number;
    totalItems: number;
  } | null;
  columns: Column<Row>[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPageChange: (page: number) => void;
  onRowOpen: (row: Row) => void;
  rowLabel: (row: Row) => string;
  emptyMessage: string;
  labels: {
    caption: string;
    loading: string;
    retry: string;
    pagination: string;
    previous: string;
    next: string;
    resultCount: (count: number) => string;
    pageStatus: (page: number, totalPages: number) => string;
  };
}

const buttonClass =
  "cursor-pointer rounded-xl border border-shell px-4 py-2.5 text-sm hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";

/**
 * Shared archive table with accessible row actions, request states and pagination.
 * @param data The paginated data to display in the table.
 * @param columns The column definitions for the table.
 * @param loading Whether the table is currently loading data.
 * @param error Any error message to display.
 * @param onRetry Callback to retry loading data.
 * @param onPageChange Callback when the page changes.
 * @param onRowOpen Callback when a row is opened.
 * @param rowLabel Function to generate an accessible label for a row.
 * @param emptyMessage Message to display when there are no items.
 * @param labels Object containing various UI labels and messages.
 */
export default function PaginatedTable<Row extends { id: number }>({
  data,
  columns,
  loading,
  error,
  onRetry,
  onPageChange,
  onRowOpen,
  rowLabel,
  emptyMessage,
  labels,
}: Props<Row>) {
  const stale = loading || error !== null;
  return (
    <>
      <div className="min-h-6 text-sm" aria-live="polite">
        {loading ? (
          <p role="status" className="text-muted">
            {labels.loading}
          </p>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-muted">
              {error}
            </p>
            <button type="button" onClick={onRetry} className={buttonClass}>
              {labels.retry}
            </button>
          </div>
        ) : (
          data && (
            <p className="text-muted">{labels.resultCount(data.totalItems)}</p>
          )
        )}
      </div>
      <div className="min-h-80 overflow-x-auto" aria-busy={loading}>
        <table
          className={`w-full text-left text-sm ${stale ? "opacity-60" : ""}`}
        >
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr className="border-b border-shell text-xs text-muted">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-3 py-3 ${column.align === "right" ? "text-right" : ""}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.items.map((row) => (
              <tr
                key={row.id}
                onClick={(event) => {
                  if (stale) return;
                  event.currentTarget.querySelector("button")?.focus();
                  onRowOpen(row);
                }}
                className={`border-b border-shell last:border-0 ${stale ? "" : "cursor-pointer hover:bg-surface-hover"}`}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`px-3 py-4 ${column.align === "right" ? "text-right" : ""} ${column.className ?? ""}`}
                  >
                    {index === 0 ? (
                      <button
                        type="button"
                        disabled={stale}
                        aria-label={rowLabel(row)}
                        className="cursor-pointer rounded text-left wrap-break-word focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-accent disabled:cursor-default"
                      >
                        {column.render(row)}
                      </button>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!stale && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data && data.totalPages > 0 && (
        <nav
          aria-label={labels.pagination}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-shell pt-5"
        >
          <button
            type="button"
            disabled={stale || data.page <= 1}
            onClick={() => onPageChange(data.page - 1)}
            className={buttonClass}
          >
            {labels.previous}
          </button>
          <p className="text-sm text-muted">
            {labels.pageStatus(data.page, data.totalPages)}
          </p>
          <button
            type="button"
            disabled={stale || data.page >= data.totalPages}
            onClick={() => onPageChange(data.page + 1)}
            className={buttonClass}
          >
            {labels.next}
          </button>
        </nav>
      )}
    </>
  );
}
