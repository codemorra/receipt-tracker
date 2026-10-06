import { useEffect, useState } from "react";

/**
 * Reads the current CSS custom properties for chart colors.
 * @returns An object containing the resolved colors for accent, text, grid, surface, and foreground.
 */
function readColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue("--accent").trim(),
    text: style.getPropertyValue("--muted").trim(),
    grid: style.getPropertyValue("--border").trim(),
    surface: style.getPropertyValue("--surface").trim(),
    foreground: style.getPropertyValue("--text").trim(),
  };
}

/**
 * Custom hook for retrieving the current chart colors from CSS custom properties.
 * Updates automatically when the app's appearance changes.
 * @returns An object containing the resolved colors for accent, text, grid, surface, and foreground.
 */
export function useChartColors() {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}
