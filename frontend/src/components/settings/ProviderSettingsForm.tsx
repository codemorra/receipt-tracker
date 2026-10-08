import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  ProviderId,
  ProviderSettings,
  ProviderUpdate,
} from "../../api/provider-settings-api";

// Props for the ProviderSettingsForm component.
interface Props {
  provider: ProviderSettings;
  isNew: boolean;
  onCancel: () => void;
  disabled: boolean;
  saving: boolean;
  onSave: (provider: ProviderId, update: ProviderUpdate) => Promise<boolean>;
}

/**
 * ProviderSettingsForm component allows the user to configure the settings for a specific AI provider.
 * @param provider The current settings for the provider.
 * @param isNew Whether this is a new provider being added.
 * @param onCancel Callback function to handle cancellation of the form.
 * @param disabled Whether the form inputs should be disabled.
 * @param saving Whether the settings are currently being saved.
 * @param onSave Callback function to handle saving the updated provider settings.
 */
export default function ProviderSettingsForm({
  provider,
  isNew,
  onCancel,
  disabled,
  saving,
  onSave,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState({
    enabled: isNew || provider.enabled,
    model:
      provider.model ||
      {
        ollama: "qwen3.8:27b",
        openai: "gpt-6-luna",
      }[provider.provider],
    baseUrl: provider.baseUrl ?? "",
    apiKey: "",
    removeKey: false,
    enabledBeforeRemoval: isNew || provider.enabled,
  });
  const cloud = provider.provider !== "ollama";
  const dirty =
    isNew ||
    draft.enabled !== provider.enabled ||
    draft.model !== provider.model ||
    (!cloud && draft.baseUrl !== provider.baseUrl) ||
    draft.apiKey !== "" ||
    draft.removeKey;
  const inputClass =
    "mt-2 w-full min-w-0 rounded-xl border border-shell bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/70 disabled:opacity-60";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const update: ProviderUpdate = {
      enabled: draft.enabled,
      model: draft.model.trim(),
      ...(!cloud ? { baseUrl: draft.baseUrl.trim() } : {}),
      ...(draft.removeKey
        ? { apiKey: { action: "remove" as const } }
        : draft.apiKey.trim()
          ? { apiKey: { action: "set" as const, value: draft.apiKey.trim() } }
          : {}),
    };
    if (await onSave(provider.provider, update)) {
      setDraft((current) => ({ ...current, apiKey: "", removeKey: false }));
    }
  }

  return (
    <div className="mt-6">
      <p className="mb-5 text-sm text-muted">
        {cloud ? t("providerSettings.cloud") : t("providerSettings.local")}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={disabled} className="min-w-0 space-y-5">
          <legend className="sr-only">
            {t("providerSettings.configuration", {
              provider: t(`providerSettings.names.${provider.provider}`),
            })}
          </legend>
          <div className="space-y-5">
            <label className="block text-sm font-medium">
              {t("providerSettings.model")}
              <input
                type="text"
                value={draft.model}
                required={draft.enabled}
                maxLength={256}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    model: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>
            {!cloud && (
              <label className="block text-sm font-medium">
                {t("providerSettings.baseUrl")}
                <input
                  type="url"
                  value={draft.baseUrl}
                  required
                  maxLength={2048}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${id}-url-hint`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
                <span
                  id={`${id}-url-hint`}
                  className="mt-2 block text-xs font-normal leading-relaxed text-muted"
                >
                  {t("providerSettings.baseUrlHint")}
                </span>
              </label>
            )}
            {cloud && (
              <div className="space-y-3">
                <label className="block text-sm font-medium">
                  {t("providerSettings.apiKey")}
                  <input
                    type="password"
                    value={draft.apiKey}
                    disabled={draft.removeKey}
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={16384}
                    required={draft.enabled && !provider.hasApiKey}
                    aria-describedby={`${id}-key-hint`}
                    placeholder={
                      provider.hasApiKey
                        ? t("providerSettings.keyReplacementPlaceholder")
                        : t("providerSettings.keyPlaceholder")
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <p
                  id={`${id}-key-hint`}
                  className="text-xs leading-relaxed text-muted"
                >
                  {provider.hasApiKey
                    ? t("providerSettings.keyPresent")
                    : t("providerSettings.keyMissing")}
                </p>
                {provider.hasApiKey && (
                  <button
                    type="button"
                    aria-pressed={draft.removeKey}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        apiKey: "",
                        removeKey: !current.removeKey,
                        enabledBeforeRemoval: current.removeKey
                          ? current.enabledBeforeRemoval
                          : current.enabled,
                        enabled: current.removeKey
                          ? current.enabledBeforeRemoval
                          : false,
                      }))
                    }
                    className="rounded-lg text-xs font-medium text-accent underline underline-offset-4 hover:text-accent-hover disabled:opacity-50"
                  >
                    {draft.removeKey
                      ? t("providerSettings.cancelKeyRemoval")
                      : t("providerSettings.removeKey")}
                  </button>
                )}
                {draft.removeKey && (
                  <p
                    role="status"
                    className="text-xs leading-relaxed text-foreground"
                  >
                    {t("providerSettings.keyRemovalPending")}
                  </p>
                )}
              </div>
            )}
          </div>
          {provider.configurationIssues.includes("secret_unavailable") && (
            <p
              role="alert"
              className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm leading-relaxed"
            >
              {t("providerSettings.secretUnavailable")}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted">
            {cloud
              ? t("providerSettings.cloudRequirements")
              : t("providerSettings.localRequirements")}
          </p>
          <div className="flex flex-wrap items-center gap-3 border-t border-shell pt-5">
            <button
              type="submit"
              disabled={!dirty || disabled}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
            >
              {saving
                ? t("providerSettings.saving")
                : t("providerSettings.save")}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-shell px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
            >
              {t("providerSettings.cancel")}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
