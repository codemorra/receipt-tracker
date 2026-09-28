import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

// Types and utilities for handling receipt image corners and preview.
export type Corner = [number, number];
export type CornerName = "topLeft" | "topRight" | "bottomRight" | "bottomLeft";
export type Corners = Record<CornerName, Corner>;
const cornerNames: CornerName[] = [
  "topLeft",
  "topRight",
  "bottomRight",
  "bottomLeft",
];

// Props for the ReceiptImagePreview component, including image URL, dimensions, corner positions, and event handlers.
interface Props {
  previewUrl: string;
  width: number;
  height: number;
  corners: Corners;
  onChange: (corners: Corners) => void;
  onImageError: () => void;
}

// ReceiptImagePreview component for displaying and adjusting receipt image corners.
function ReceiptImagePreview({
  previewUrl,
  width,
  height,
  corners,
  onChange,
  onImageError,
}: Props) {
  const { t } = useTranslation();
  const imageRef = useRef<HTMLImageElement>(null);
  const polygon = cornerNames
    .map((name) => corners[name].map((value) => value * 100).join(","))
    .join(" ");

  /**
   * Moves a specified corner to a new position, clamping the coordinates within the valid range [0, 1].
   * @param name The name of the corner to move.
   * @param x The new x-coordinate of the corner, clamped between 0 and 1.
   * @param y The new y-coordinate of the corner, clamped between 0 and 1.
   */
  function moveCorner(name: CornerName, x: number, y: number) {
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    onChange({ ...corners, [name]: [clamp(x), clamp(y)] });
  }

  /**
   * Moves a corner based on pointer events, translating the pointer position to normalized coordinates relative to the image.
   * @param event The pointer event containing the current pointer position.
   * @param name The name of the corner to move.
   */
  function moveWithPointer(
    event: PointerEvent<HTMLButtonElement>,
    name: CornerName,
  ) {
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    moveCorner(
      name,
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    );
  }

  /**
   * Moves a corner based on keyboard events, adjusting its position by a small step.
   * @param event The keyboard event containing the key pressed and modifier keys.
   * @param name The name of the corner to move.
   */
  function moveWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    name: CornerName,
  ) {
    const step = event.shiftKey ? 0.02 : 0.005;
    const [x, y] = corners[name];
    switch (event.key) {
      case "ArrowLeft":
        moveCorner(name, x - step, y);
        break;
      case "ArrowRight":
        moveCorner(name, x + step, y);
        break;
      case "ArrowUp":
        moveCorner(name, x, y - step);
        break;
      case "ArrowDown":
        moveCorner(name, x, y + step);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-slate-900 shadow-lg"
      style={{ aspectRatio: width / height }}
    >
      <img
        ref={imageRef}
        src={previewUrl}
        alt={t("previewAlt")}
        onError={onImageError}
        className="block h-full w-full"
        draggable={false}
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <polygon
          points={polygon}
          className="fill-emerald-400/20 stroke-emerald-300"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {cornerNames.map((name) => (
        <button
          key={name}
          type="button"
          aria-label={t("corners." + name)}
          aria-describedby="corner-instructions"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            moveWithPointer(event, name);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              moveWithPointer(event, name);
          }}
          onPointerUp={(event) =>
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          onKeyDown={(event) => moveWithKeyboard(event, name)}
          className="absolute z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-emerald-500 shadow-md focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          style={{
            left: String(corners[name][0] * 100) + "%",
            top: String(corners[name][1] * 100) + "%",
          }}
        />
      ))}
    </div>
  );
}

export default ReceiptImagePreview;
