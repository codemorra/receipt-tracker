/**
 * Normalizes package amounts and units for consistent representation.
 * @param amount The numeric amount of the package.
 * @param unit The unit of the package (e.g., "kg", "l", "g", "ml").
 * @returns A string representing the normalized package, or null if input is invalid.
 */
export function normalizedPackage(
  amount: number | null,
  unit: string | null,
): string | null {
  if (amount === null || unit === null) return null;
  if (unit === "kg" || unit === "l")
    return `${amount * 1000} ${unit === "kg" ? "g" : "ml"}`;
  return `${amount} ${unit}`;
}
