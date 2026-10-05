import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

// Props for the UploadDropzone component.
interface Props {
  file: File | null;
  disabled: boolean;
  onSelect: (file: File) => void;
}

/**
 * UploadDropzone component for handling file uploads via drag-and-drop or file selection.
 * @param file - The currently selected file.
 * @param disabled - Whether the dropzone is disabled.
 * @param onSelect - Callback for when a file is selected.
 */
export default function UploadDropzone({ file, disabled, onSelect }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [dragging, setDragging] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled && event.dataTransfer.files[0])
          onSelect(event.dataTransfer.files[0]);
      }}
      className={`group flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus-within:border-accent ${disabled ? "cursor-default opacity-60" : "cursor-pointer hover:border-accent/60 hover:bg-accent/5"} ${dragging ? "border-accent bg-accent/10" : "border-shell bg-canvas/50"}`}
    >
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onSelect(file);
        }}
      />
      <svg
        aria-hidden="true"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        className="text-accent"
      >
        <path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5" />
      </svg>
      <div className="min-w-0 max-w-full">
        <p className="truncate text-sm font-semibold">
          {file ? file.name : t("pages.import.scan.chooseFile")}
        </p>
        {!(file && disabled) && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {file
              ? t("pages.import.scan.replaceFile")
              : t("pages.import.scan.dropHint")}
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          {t("pages.import.scan.formats")}
        </p>
      </div>
    </label>
  );
}
