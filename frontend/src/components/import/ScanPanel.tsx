import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImportAction, ImportState } from "../../scans/import-state";
import type { AiSettings, ProviderId } from "../../api/provider-settings-api";
import type { ScanErrorCode } from "../../api/scan-api";
import Card from "../ui/Card";
import Select from "../ui/Select";
import Dropdown from "../ui/Dropdown";
import UploadDropzone from "./UploadDropzone";
import ScanFrame from "./ScanFrame";

// Props for the ScanPanel component.
interface Props {
  state: ImportState;
  locked?: boolean;
  settings: AiSettings | null;
  provider: ProviderId | null;
  loadingProviders: boolean;
  onProvider: (provider: ProviderId | null) => void;
  dispatch: (action: ImportAction) => void;
  onSelectFile: (file: File) => void;
  onUpload: () => void;
  onProcess: (provider: ProviderId) => void;
  onError: (code: ScanErrorCode) => void;
}

/**
 * ScanPanel component for managing the scan process, including uploading, previewing, and processing scans.
 * @param state - The current import state.
 * @param locked - Whether the scan panel is locked.
 * @param settings - The AI settings.
 * @param provider - The selected provider.
 * @param loadingProviders - Whether the providers are currently loading.
 * @param onProvider - Callback for when the provider changes.
 * @param dispatch - Dispatch function for import actions.
 * @param onSelectFile - Callback for when a file is selected.
 * @param onUpload - Callback for when the upload button is clicked.
 * @param onProcess - Callback for when the process button is clicked.
 * @param onError - Callback for when an error occurs.
 */
export default function ScanPanel({
  state,
  locked = false,
  settings,
  provider,
  loadingProviders,
  onProvider,
  dispatch,
  onSelectFile,
  onUpload,
  onProcess,
  onError,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  const available =
    settings?.providers.filter((entry) => entry.selectable) ?? [];
  const canProcess = available.some((entry) => entry.provider === provider);
  const { scan, corners, processed, busy } = state;
  const archive = processed && !editing;
  const imageUrl = archive
    ? `${processed.archiveUrl}?v=${state.generation}`
    : scan?.previewUrl;
  const failed = Boolean(imageUrl && imageFailed === imageUrl);
  const secondary =
    "rounded-xl border border-shell px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-hover disabled:opacity-50";
  return (
    <Card
      aria-labelledby={`${id}-heading`}
      className="min-w-0 p-5 sm:p-6"
      aria-busy={busy !== null || locked}
      inert={locked}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          {t("pages.import.scan.title")}
        </h2>
        {archive && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setEditing(true)}
            className={secondary}
          >
            {t("pages.import.scan.edit")}
          </button>
        )}
      </div>
      {scan && corners && !archive && (
        <div className="mb-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full min-w-0 sm:w-52 sm:grow sm:basis-52 sm:max-w-72">
              <Select
                compact
                label={t("pages.import.scan.provider")}
                value={provider ?? ""}
                disabled={busy !== null || loadingProviders}
                onChange={(value) =>
                  onProvider(value ? (value as ProviderId) : null)
                }
                options={[
                  ...(!provider
                    ? [
                        {
                          value: "",
                          label: t("pages.import.scan.chooseProvider"),
                        },
                      ]
                    : []),
                  ...available.map((entry) => ({
                    value: entry.provider,
                    label: `${t(`providerSettings.names.${entry.provider}`)} · ${entry.model}`,
                  })),
                ]}
              />
            </div>
            <div className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || failed}
                  onClick={() => dispatch({ type: "rotate", turn: 270 })}
                  aria-label={t("pages.import.scan.rotateLeft")}
                  title={t("pages.import.scan.rotateLeft")}
                  className={`${secondary} flex items-center justify-center`}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={busy !== null || failed}
                  onClick={() => dispatch({ type: "rotate", turn: 90 })}
                  aria-label={t("pages.import.scan.rotateRight")}
                  title={t("pages.import.scan.rotateRight")}
                  className={`${secondary} flex items-center justify-center`}
                >
                  <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="-scale-x-100"
                  >
                    <path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6" />
                  </svg>
                </button>

                <Dropdown
                  label={t("pages.import.scan.selection")}
                  groupLabel={t("pages.import.scan.selection")}
                  disabled={busy !== null || failed}
                  triggerClassName="flex items-center gap-2 px-3 py-2.5 text-sm"
                  panelClassName="w-max min-w-40 max-w-[calc(100vw-3rem)] p-2"
                  trigger={
                    <>
                      {t("pages.import.scan.selection")}
                      <span aria-hidden="true">⌄</span>
                    </>
                  }
                >
                  <button
                    type="button"
                    disabled={busy !== null || failed}
                    onClick={() =>
                      dispatch({
                        type: "corners",
                        corners: {
                          topLeft: [0, 0],
                          topRight: [1, 0],
                          bottomRight: [1, 1],
                          bottomLeft: [0, 1],
                        },
                      })
                    }
                    className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                  >
                    {t("pages.import.scan.fullImage")}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null || failed}
                    onClick={() => dispatch({ type: "receipt-frame" })}
                    className="block w-full rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-hover disabled:opacity-50"
                  >
                    {t("pages.import.scan.receiptOnly")}
                  </button>
                </Dropdown>
              </div>
              <button
                type="button"
                disabled={
                  busy !== null || loadingProviders || !canProcess || failed
                }
                onClick={() => {
                  if (provider) {
                    setEditing(false);
                    onProcess(provider);
                  }
                }}
                className="inline-flex grow items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-45 sm:grow-0"
              >
                {t(
                  busy === "process"
                    ? "pages.import.scan.processing"
                    : "pages.import.scan.process",
                )}
              </button>
            </div>
          </div>
          {processed && editing && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={secondary}
            >
              {t("pages.import.scan.showArchive")}
            </button>
          )}
          {!loadingProviders && available.length === 0 && (
            <p className="text-xs leading-relaxed text-muted">
              {t("pages.import.scan.noProviders")}
            </p>
          )}
        </div>
      )}
      {!scan ? (
        <>
          <UploadDropzone
            file={state.file}
            disabled={busy !== null}
            onSelect={onSelectFile}
          />
          {busy === "upload" ? (
            <p role="status" className="mt-4 text-center text-sm text-muted">
              {t("pages.import.scan.uploading")}
            </p>
          ) : state.file ? (
            <button
              type="button"
              onClick={onUpload}
              disabled={busy !== null}
              className="mt-5 w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-45"
            >
              {t("pages.import.scan.retryPreview")}
            </button>
          ) : null}
        </>
      ) : (
        corners && (
          <>
            {archive ? (
              <img
                key={imageUrl}
                src={imageUrl}
                alt={t("pages.import.scan.archiveAlt")}
                className="h-auto w-full rounded-lg shadow-soft"
                onError={() => {
                  setImageFailed(imageUrl ?? null);
                  onError("archive_unavailable");
                }}
              />
            ) : (
              <ScanFrame
                key={scan.scanId}
                url={scan.previewUrl}
                width={scan.width}
                height={scan.height}
                rotation={
                  ((state.rotation - scan.rotation + 360) % 360) as
                    0 | 90 | 180 | 270
                }
                corners={corners}
                disabled={busy !== null || failed}
                onChange={(corners) => dispatch({ type: "corners", corners })}
                onError={() => {
                  setImageFailed(scan.previewUrl);
                  onError("preview_unavailable");
                }}
              />
            )}
          </>
        )
      )}
    </Card>
  );
}
