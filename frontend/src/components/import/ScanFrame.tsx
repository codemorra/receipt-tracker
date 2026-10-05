import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  CornerName,
  Corners,
  Rotation,
} from "../../scans/scan-orientation";

// Names of the corners in the scan frame.
const names: CornerName[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
];

// Props for the ScanFrame component.
interface Props {
  url: string;
  width: number;
  height: number;
  rotation: Rotation;
  corners: Corners;
  disabled: boolean;
  onChange: (corners: Corners) => void;
  onError: () => void;
}

/**
 * ScanFrame component for displaying and interacting with a scan image.
 * @param url - The URL of the scan image.
 * @param width - The width of the scan image.
 * @param height - The height of the scan image.
 * @param rotation - The rotation of the scan image.
 * @param corners - The corners of the scan image.
 * @param disabled - Whether the scan frame is disabled.
 * @param onChange - Callback for when the corners change.
 * @param onError - Callback for when the image fails to load.
 */
export default function ScanFrame({
  url,
  width,
  height,
  rotation,
  corners,
  disabled,
  onChange,
  onError,
}: Props) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const sideways = rotation === 90 || rotation === 270;
  const ratio = sideways ? height / width : width / height;
  function move(name: CornerName, x: number, y: number) {
    if (disabled) return;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    onChange({ ...corners, [name]: [clamp(x), clamp(y)] });
  }

  /**
   * Handles the drag event for a corner button.
   * @param event - The pointer event.
   * @param name - The name of the corner being dragged.
   */
  function drag(event: PointerEvent<HTMLButtonElement>, name: CornerName) {
    const bounds = frame.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    move(
      name,
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  }

  /**
   * Handles the keyboard event for a corner button.
   * @param event - The keyboard event.
   * @param name - The name of the corner being adjusted.
   */
  function key(event: KeyboardEvent<HTMLButtonElement>, name: CornerName) {
    const step = event.shiftKey ? 0.02 : 0.005;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    move(
      name,
      corners[name][0] + direction[0],
      corners[name][1] + direction[1],
    );
  }

  return (
    <div ref={frame} className="relative w-full" style={{ aspectRatio: ratio }}>
      <div className="absolute inset-0 overflow-hidden rounded-lg bg-canvas shadow-soft">
        <img
          src={url}
          alt={t("pages.import.scan.previewAlt")}
          onError={onError}
          draggable={false}
          className="absolute top-1/2 left-1/2 max-w-none"
          style={{
            width: sideways ? `${(width / height) * 100}%` : "100%",
            height: sideways ? `${(height / width) * 100}%` : "100%",
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          }}
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <polygon
            points={names
              .map((name) =>
                corners[name].map((value) => value * 100).join(","),
              )
              .join(" ")}
            className="fill-accent/15 stroke-accent"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          disabled={disabled}
          aria-label={t(`pages.import.scan.corners.${name}`)}
          title={t("pages.import.scan.keyboardHint")}
          className="absolute z-10 size-6 -translate-1/2 touch-none rounded-full border-2 border-surface bg-accent shadow-soft disabled:opacity-50"
          style={{
            left: `${corners[name][0] * 100}%`,
            top: `${corners[name][1] * 100}%`,
          }}
          onPointerDown={(event) => {
            if (disabled) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              drag(event, name);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onKeyDown={(event) => key(event, name)}
        />
      ))}
    </div>
  );
}
