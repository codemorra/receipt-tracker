// Sections and routing types for the application.
export const sections = [
  "import",
  "receipts",
  "analytics",
  "warranties",
  "settings",
] as const;
export type Section = (typeof sections)[number];
export type NavigationTarget = Section | "home";
export type Route = NavigationTarget | "notFound";

/**
 * Extracts the receipt ID from the search string.
 * @param search The search string from the URL.
 * @returns The receipt ID if present and valid, otherwise null.
 */
export function receiptIdFromSearch(search: string): number | null {
  const value = new URLSearchParams(search).get("receiptId");
  const id = Number(value);
  return value !== null && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Resolves the route based on the pathname and search string.
 * @param pathname The pathname from the URL.
 * @param search The search string from the URL.
 * @returns The resolved route.
 */
export function resolveRoute(pathname: string, search: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (receiptIdFromSearch(search) !== null) return "import";
  if (path === "/") return "home";
  return sections.find((section) => path === `/${section}`) ?? "notFound";
}
