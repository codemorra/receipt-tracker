import { useTranslation } from "react-i18next";
import { modes, type ThemeMode } from "../../appearance/appearance";
import Dropdown from "../ui/Dropdown";
import ThemeIcon from "./ThemeIcon";

// Props for the ThemePicker component.
interface Props {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

/**
 * ThemePicker component for selecting the application's theme mode.
 * @param mode The currently selected theme mode ("light", "dark", or "system").
 * @param onChange Callback function to update the selected theme mode.
 */
export default function ThemePicker({ mode: selectedMode, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <Dropdown
      label={`${t("appearance.mode.label")}: ${t(`appearance.mode.${selectedMode}`)}`}
      groupLabel={t("appearance.mode.label")}
      triggerClassName="flex min-w-0 items-center gap-2.5 px-3.5 py-3 text-sm font-medium sm:min-w-32 max-sm:px-2.5 [&>svg:first-child]:text-accent"
      panelClassName="w-48 p-2"
      trigger={
        <>
          <ThemeIcon mode={selectedMode} />
          <span className="max-[380px]:hidden">
            {t(`appearance.mode.${selectedMode}`)}
          </span>
          <svg
            className="ml-auto text-muted transition-transform duration-150 group-open/dropdown:rotate-180 motion-reduce:transition-none"
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="m5 8 5 5 5-5" />
          </svg>
        </>
      }
    >
      <>
        <p className="px-2.5 py-2 text-xs font-semibold text-muted">
          {t("appearance.mode.label")}
        </p>
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            className="group/option flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-3 text-left text-sm hover:bg-surface-hover aria-pressed:bg-(image:--accent-gradient) aria-pressed:text-accent"
            aria-pressed={selectedMode === mode}
            onClick={() => onChange(mode)}
          >
            <ThemeIcon mode={mode} />
            <span>{t(`appearance.mode.${mode}`)}</span>
            <svg
              className="invisible ml-auto group-aria-pressed/option:visible"
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m4 10 4 4 8-8" />
            </svg>
          </button>
        ))}
      </>
    </Dropdown>
  );
}
