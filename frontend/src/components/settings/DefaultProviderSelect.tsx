import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { AiSettings, ProviderId } from "../../api/provider-settings-api";
import Card from "../ui/Card";
import Select from "../ui/Select";

// Props for the DefaultProviderSelect component.
interface Props {
  settings: AiSettings;
  disabled: boolean;
  onChange: (provider: ProviderId | null) => Promise<boolean>;
}

/**
 * DefaultProviderSelect component allows the user to select the default AI provider.
 * @param settings The current AI settings including the list of providers and the default provider.
 * @param disabled Whether the select input should be disabled.
 * @param onChange Callback function to handle changes to the default provider.
 */
export default function DefaultProviderSelect({
  settings,
  disabled,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const available = settings.providers.filter(
    (provider) => provider.selectable,
  );
  const unavailableDefault =
    settings.defaultProvider &&
    !available.some(
      (provider) => provider.provider === settings.defaultProvider,
    );
  return (
    <Card aria-labelledby={`${id}-heading`} className="mb-6">
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1fr)_minmax(12rem,14rem)]">
        <div>
          <h2 id={`${id}-heading`} className="text-lg font-semibold">
            {t("providerSettings.default.title")}
          </h2>
          <p
            id={`${id}-hint`}
            className="mt-2 text-sm leading-relaxed text-muted"
          >
            {t("providerSettings.default.hint")}
          </p>
        </div>
        <div>
          <Select
            label={t("providerSettings.default.title")}
            value={settings.defaultProvider ?? ""}
            disabled={disabled}
            onChange={(value) => {
              void onChange(value ? (value as ProviderId) : null);
            }}
            options={[
              { value: "", label: t("providerSettings.default.none") },
              ...(unavailableDefault
                ? [
                    {
                      value: settings.defaultProvider!,
                      label: t("providerSettings.default.unavailable", {
                        provider: t(
                          `providerSettings.names.${settings.defaultProvider}`,
                        ),
                      }),
                      disabled: true,
                    },
                  ]
                : []),
              ...available.map((provider) => ({
                value: provider.provider,
                label: t(`providerSettings.names.${provider.provider}`),
              })),
            ]}
          />
        </div>
      </div>
      {available.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          {t("providerSettings.default.noProviders")}
        </p>
      )}
    </Card>
  );
}
