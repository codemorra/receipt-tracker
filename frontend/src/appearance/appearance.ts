export const modes = ["light", "dark", "system"] as const;
export const accents = ["blue", "green", "purple", "orange"] as const;
export type ThemeMode = (typeof modes)[number];
export type Accent = (typeof accents)[number];
export interface Appearance {
  mode: ThemeMode;
  accent: Accent;
}
export const appearanceKey = "receipt-tracker.appearance";
const defaults: Appearance = { mode: "system", accent: "blue" };

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

/**
 * Reads the appearance settings from the given storage.
 * @param storage - The storage to read from.
 * @returns The appearance settings.
 */
export function readAppearance(storage: StorageReader): Appearance {
  try {
    const value: unknown = JSON.parse(storage.getItem(appearanceKey) ?? "null");
    if (!value || typeof value !== "object") return { ...defaults };
    const saved = value as Partial<Appearance>;
    return {
      mode: modes.includes(saved.mode as ThemeMode)
        ? saved.mode!
        : defaults.mode,
      accent: accents.includes(saved.accent as Accent)
        ? saved.accent!
        : defaults.accent,
    };
  } catch {
    return { ...defaults };
  }
}

/**
 * Saves the appearance settings to the given storage.
 * @param storage - The storage to write to.
 * @param value - The appearance settings to save.
 */
export function saveAppearance(
  storage: StorageWriter,
  value: Appearance,
): void {
  try {
    storage.setItem(appearanceKey, JSON.stringify(value));
  } catch {
    // Private browsing or disabled storage must not prevent UI changes.
  }
}

/**
 * Resolves the effective theme based on the given mode and system preference.
 * @param mode - The theme mode.
 * @param systemDark - Whether the system prefers dark mode.
 * @returns The resolved theme, either "light" or "dark".
 */
export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

/**
 * Loads the appearance settings from localStorage.
 * @returns The appearance settings.
 */
export function loadAppearance(): Appearance {
  try {
    return readAppearance(window.localStorage);
  } catch {
    return { ...defaults };
  }
}

/**
 * Persists the appearance settings to localStorage.
 * @param value - The appearance settings to persist.
 */
export function persistAppearance(value: Appearance): void {
  try {
    saveAppearance(window.localStorage, value);
  } catch {
    // Accessing localStorage itself may be blocked by the browser.
  }
}
