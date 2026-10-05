import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ProviderSettingsManager from "../components/settings/ProviderSettingsManager";
import DefaultProviderSelect from "../components/settings/DefaultProviderSelect";
import PageHeader from "../components/ui/PageHeader";
import Toast from "../components/ui/Toast";
import { useProviderSettings } from "../hooks/useProviderSettings";

// Page component for managing application settings.
export default function SettingsPage() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const {
    settings,
    loading,
    error,
    busy,
    notice,
    dismissNotice,
    reload,
    saveProvider,
    removeProvider,
    saveDefault,
  } = useProviderSettings();
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    document.title = `${t("pages.settings.title")} · ${t("common.appName")}`;
  }, [t]);
  return (
    <>
      <PageHeader
        title={t("pages.settings.title")}
        description={t("pages.settings.description")}
        headingRef={heading}
      />
      {notice && (
        <Toast
          key={notice.id}
          tone={notice.kind === "error" ? "error" : "success"}
          onDismiss={dismissNotice}
          message={
            notice.kind === "error"
              ? t(`providerSettings.errors.${notice.code}`)
              : notice.target === "default"
                ? t("providerSettings.default.saved")
                : notice.kind === "removed"
                  ? t("providerSettings.removed", {
                      provider: t(`providerSettings.names.${notice.target}`),
                    })
                  : t("providerSettings.saved", {
                      provider: t(`providerSettings.names.${notice.target}`),
                    })
          }
        />
      )}
      {!settings && loading && (
        <p role="status" className="text-sm text-muted">
          {t("providerSettings.loading")}
        </p>
      )}
      {!settings && !loading && error && (
        <button
          type="button"
          onClick={reload}
          className="rounded-xl border border-shell bg-surface px-4 py-2.5 text-sm font-medium text-accent hover:bg-surface-hover"
        >
          {t("providerSettings.retry")}
        </button>
      )}
      {settings && (
        <>
          <DefaultProviderSelect
            settings={settings}
            disabled={loading || busy !== null}
            onChange={saveDefault}
          />
          <ProviderSettingsManager
            settings={settings}
            disabled={loading || busy !== null}
            busy={busy}
            onSave={saveProvider}
            onDelete={removeProvider}
            onDismissNotice={dismissNotice}
          />
          <p className="mt-6 text-xs leading-relaxed text-muted">
            {t("providerSettings.secretHint")}
          </p>
        </>
      )}
    </>
  );
}
