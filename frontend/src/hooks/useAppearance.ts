import { useEffect, useState } from "react";
import {
  loadAppearance,
  persistAppearance,
  resolveTheme,
} from "../appearance/appearance";

// Custom hook for managing and applying appearance settings (theme and accent).
export function useAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(
        appearance.mode,
        media.matches,
      );
      document.documentElement.dataset.accent = appearance.accent;
    };
    apply();
    persistAppearance(appearance);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  return { appearance, setAppearance };
}
