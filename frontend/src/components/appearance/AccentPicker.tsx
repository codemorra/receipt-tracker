import { useTranslation } from "react-i18next";
import { accents, type Accent } from "../../appearance/appearance";
import Dropdown from "../ui/Dropdown";
import ColorSwatch from "./ColorSwatch";

// Props for the AccentPicker component.
interface Props {
  accent: Accent;
  onChange: (accent: Accent) => void;
}

/**
 * AccentPicker component for selecting the accent color.
 * @param accent The currently selected accent color.
 * @param onChange Callback function to update the selected accent color.
 */
export default function AccentPicker({
  accent: selectedAccent,
  onChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dropdown
      label={`${t("appearance.accent.label")}: ${t(`appearance.accent.${selectedAccent}`)}`}
      groupLabel={t("appearance.accent.label")}
      title={t("appearance.accent.label")}
      triggerClassName="flex size-11 items-center justify-center"
      panelClassName="p-1.5"
      trigger={<ColorSwatch accent={selectedAccent} />}
    >
      <div className="flex flex-col gap-1">
        {accents.map((accent) => (
          <button
            key={accent}
            type="button"
            aria-pressed={selectedAccent === accent}
            className="group/color flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-surface-hover aria-pressed:bg-accent-soft"
            aria-label={t(`appearance.accent.${accent}`)}
            onClick={() => onChange(accent)}
          >
            <ColorSwatch
              accent={accent}
              className="group-aria-pressed/color:outline-2 group-aria-pressed/color:outline-offset-4 group-aria-pressed/color:outline-accent"
            />
          </button>
        ))}
      </div>
    </Dropdown>
  );
}
