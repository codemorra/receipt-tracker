import { useAppearance } from "../../hooks/useAppearance";
import LanguageSwitch from "./LanguageSwitch";
import ThemePicker from "./ThemePicker";
import AccentPicker from "./AccentPicker";

/**
 * GlobalControls component for managing global appearance settings.
 */
export default function GlobalControls() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2.5 sm:gap-3.5">
      <LanguageSwitch />
      <span className="h-6 w-px bg-shell max-sm:hidden" aria-hidden="true" />
      <ThemePicker
        mode={appearance.mode}
        onChange={(mode) => setAppearance((current) => ({ ...current, mode }))}
      />
      <AccentPicker
        accent={appearance.accent}
        onChange={(accent) =>
          setAppearance((current) => ({ ...current, accent }))
        }
      />
    </div>
  );
}
