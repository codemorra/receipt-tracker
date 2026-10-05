import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AiSettings,
  ProviderId,
  ProviderUpdate,
} from "../../api/provider-settings-api";
import Card from "../ui/Card";
import Modal from "../ui/Modal";
import Select from "../ui/Select";
import ProviderSettingsForm from "./ProviderSettingsForm";

// Props for the ProviderSettingsManager component.
interface Props {
  settings: AiSettings;
  disabled: boolean;
  busy: ProviderId | "default" | null;
  onSave: (provider: ProviderId, update: ProviderUpdate) => Promise<boolean>;
  onDelete: (provider: ProviderId) => Promise<boolean>;
  onDismissNotice: () => void;
}

/**
 * ProviderSettingsManager component allows the user to manage the settings for all AI providers.
 * @param settings The current AI settings including the list of providers and the default provider.
 * @param disabled Whether the form inputs should be disabled.
 * @param busy The ID of the provider currently being updated, "default" if the default provider is being updated, or null if no update is in progress.
 * @param onSave Callback function to handle saving the updated provider settings.
 * @param onDelete Callback function to handle deleting a provider.
 * @param error The current error code, if any.
 */
export default function ProviderSettingsManager({
  settings,
  disabled,
  busy,
  onSave,
  onDelete,
  onDismissNotice,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [editor, setEditor] = useState<{
    mode: "add" | "edit";
    provider: ProviderId | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<ProviderId | null>(null);
  const deleteTarget = settings.providers.find(
    (provider) => provider.provider === deleting,
  );
  const configured = settings.providers.filter(
    (provider) =>
      provider.model.trim() !== "" || provider.hasApiKey || provider.enabled,
  );
  const available = settings.providers.filter(
    (provider) => !configured.includes(provider),
  );
  const selected = settings.providers.find(
    (provider) => provider.provider === editor?.provider,
  );

  function closeEditor() {
    onDismissNotice();
    setEditor(null);
  }

  function closeDeletion() {
    onDismissNotice();
    setDeleting(null);
  }

  async function save(provider: ProviderId, update: ProviderUpdate) {
    const success = await onSave(provider, update);
    if (success) setEditor(null);
    return success;
  }

  return (
    <div className="space-y-6">
      {editor && (
        <Modal
          title={
            editor.mode === "add"
              ? t("providerSettings.add")
              : t("providerSettings.editTitle")
          }
          busy={disabled}
          onClose={closeEditor}
        >
          <div className="mt-5 w-full max-w-64 space-y-2">
            <p className="text-sm font-medium">
              {t("providerSettings.provider")}
            </p>
            <Select
              floatingPanel
              label={t("providerSettings.provider")}
              value={editor.provider ?? ""}
              disabled={disabled || editor.mode === "edit"}
              onChange={(value) =>
                setEditor({
                  mode: "add",
                  provider: value ? (value as ProviderId) : null,
                })
              }
              options={[
                { value: "", label: t("providerSettings.chooseProvider") },
                ...(editor.mode === "edit" && selected
                  ? [selected]
                  : available
                ).map((provider) => ({
                  value: provider.provider,
                  label: t(`providerSettings.names.${provider.provider}`),
                })),
              ]}
            />
          </div>
          {selected && (
            <ProviderSettingsForm
              key={`${editor.mode}:${selected.provider}:${selected.enabled}:${selected.model}:${selected.baseUrl ?? ""}:${selected.hasApiKey}:${selected.configurationIssues.join(",")}`}
              provider={selected}
              isNew={editor.mode === "add"}
              disabled={disabled}
              saving={busy === selected.provider}
              onSave={save}
              onCancel={closeEditor}
            />
          )}
          {!selected && (
            <button
              type="button"
              disabled={disabled}
              onClick={closeEditor}
              className="mt-6 rounded-xl border border-shell px-4 py-2.5 text-sm text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {t("providerSettings.cancel")}
            </button>
          )}
        </Modal>
      )}
      {deleteTarget && (
        <Modal
          title={t("providerSettings.deleteTitle")}
          busy={disabled}
          onClose={closeDeletion}
        >
          <p className="mt-5 text-sm leading-relaxed text-muted">
            {t("providerSettings.deleteConfirmation", {
              provider: t(`providerSettings.names.${deleteTarget.provider}`),
              model: deleteTarget.model || "—",
            })}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={closeDeletion}
              className="rounded-xl border border-shell px-4 py-2.5 text-sm text-muted hover:bg-surface-hover disabled:opacity-50"
            >
              {t("providerSettings.cancel")}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (await onDelete(deleteTarget.provider)) setDeleting(null);
              }}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-50"
            >
              {disabled
                ? t("providerSettings.saving")
                : t("providerSettings.deleteTitle")}
            </button>
          </div>
        </Modal>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || available.length === 0}
          onClick={() => setEditor({ mode: "add", provider: null })}
          className="rounded-xl border border-accent/25 bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent transition-colors hover:bg-accent/15 disabled:cursor-default disabled:opacity-45"
        >
          <span aria-hidden="true" className="mr-2">
            +
          </span>
          {t("providerSettings.add")}
        </button>
        {available.length === 0 && (
          <p className="text-xs text-muted">
            {t("providerSettings.allConfigured")}
          </p>
        )}
      </div>
      <Card aria-labelledby={`${id}-list-heading`}>
        <h2 id={`${id}-list-heading`} className="mb-4 text-lg font-semibold">
          {t("providerSettings.listTitle")}
        </h2>
        {configured.length === 0 ? (
          <p className="text-sm text-muted">
            {t("providerSettings.emptyList")}
          </p>
        ) : (
          <ul className="divide-y divide-shell">
            {configured.map((provider) => {
              const status = !provider.enabled
                ? "disabled"
                : provider.selectable
                  ? "ready"
                  : "unavailable";
              const name = t(`providerSettings.names.${provider.provider}`);
              return (
                <li
                  key={provider.provider}
                  className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="shrink-0 text-sm font-semibold">
                      {name}
                    </span>
                    <span
                      className="truncate text-sm text-muted"
                      title={provider.model}
                    >
                      {provider.model || "—"}
                    </span>
                  </div>
                  <span
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${provider.selectable ? "border-accent/25 bg-accent-soft text-accent" : "border-shell text-muted"}`}
                  >
                    {t(`providerSettings.status.${status}`)}
                  </span>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        setEditor({ mode: "edit", provider: provider.provider })
                      }
                      aria-label={t("providerSettings.edit", {
                        provider: name,
                      })}
                      className="rounded-lg text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                    >
                      {t("providerSettings.editTitle")}
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setDeleting(provider.provider)}
                      aria-label={t("providerSettings.delete", {
                        provider: name,
                        model: provider.model,
                      })}
                      className="rounded-lg text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
                    >
                      {t("providerSettings.deleteTitle")}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={provider.enabled}
                      aria-label={t("providerSettings.enabledFor", {
                        provider: name,
                        model: provider.model,
                      })}
                      disabled={
                        disabled || editor?.provider === provider.provider
                      }
                      onClick={() => {
                        void onSave(provider.provider, {
                          enabled: !provider.enabled,
                          model: provider.model,
                        });
                      }}
                      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${provider.enabled ? "border-accent bg-accent" : "border-shell bg-surface-hover"}`}
                    >
                      <span
                        className={`absolute left-1 top-0.75 size-4 rounded-full bg-foreground shadow-sm transition-transform ${provider.enabled ? "translate-x-5" : "-translate-x-px"}`}
                      />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
