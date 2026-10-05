import { useCallback, useEffect, useRef, useState } from "react";
import {
  getProviderSettings,
  updateDefaultProvider,
  updateProviderSettings,
  ProviderSettingsApiError,
  providerResetUpdate,
  type AiSettings,
  type ProviderId,
  type ProviderUpdate,
  type SettingsErrorCode,
} from "../api/provider-settings-api";

type Target = ProviderId | "default";
type Notice =
  | { id: number; kind: "saved" | "removed"; target: Target }
  | { id: number; kind: "error"; code: SettingsErrorCode };

// Hook for managing AI provider settings.
export function useProviderSettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettingsErrorCode | null>(null);
  const [busy, setBusy] = useState<Target | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeId = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);

  // Ref to keep track of the pending API request.
  useEffect(() => () => pending.current?.abort(), []);

  // Effect to fetch the initial provider settings.
  useEffect(() => {
    const controller = new AbortController();
    getProviderSettings(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSettings(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          const code =
            error instanceof ProviderSettingsApiError
              ? error.code
              : "unexpected_response";
          setError(code);
          setNotice({ id: ++noticeId.current, kind: "error", code });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);

  // Function to reload the provider settings.
  function reload() {
    if (pending.current) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setAttempt((value) => value + 1);
  }

  // Function to perform a mutation on the provider settings.
  async function mutate(
    target: Target,
    operation: (
      signal: AbortSignal,
    ) => Promise<(current: AiSettings) => AiSettings>,
    kind: "saved" | "removed" = "saved",
  ): Promise<boolean> {
    if (!settings || loading || pending.current) return false;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(target);
    setError(null);
    setNotice(null);
    try {
      const apply = await operation(controller.signal);
      if (controller.signal.aborted) return false;
      setSettings((current) => (current ? apply(current) : current));
      setNotice({ id: ++noticeId.current, kind, target });
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        const code =
          error instanceof ProviderSettingsApiError
            ? error.code
            : "unexpected_response";
        setError(code);
        setNotice({ id: ++noticeId.current, kind: "error", code });
      }
      return false;
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(null);
      }
    }
  }

  /**
   * Saves the settings for a specific provider.
   * @param provider The ID of the provider to update.
   * @param update The update to apply to the provider's settings.
   * @returns A promise that resolves to a boolean indicating whether the update was successful.
   */
  function saveProvider(
    provider: ProviderId,
    update: ProviderUpdate,
    kind: "saved" | "removed" = "saved",
  ) {
    return mutate(
      provider,
      async (signal) => {
        const result = await updateProviderSettings(provider, update, signal);
        return (current) => ({
          providers: current.providers.map((entry) =>
            entry.provider === provider ? result : entry,
          ),
          defaultProvider:
            current.defaultProvider === provider && !result.selectable
              ? null
              : current.defaultProvider,
        });
      },
      kind,
    );
  }

  /**
   * Saves the default provider setting.
   * @param provider The ID of the provider to set as default, or null to unset.
   * @returns A promise that resolves to a boolean indicating whether the update was successful.
   */
  function saveDefault(provider: ProviderId | null) {
    return mutate("default", async (signal) => {
      const defaultProvider = await updateDefaultProvider(provider, signal);
      return (current) => ({ ...current, defaultProvider });
    });
  }

  /**
   * Removes a specific provider by resetting its settings.
   * @param provider The ID of the provider to remove.
   * @returns A promise that resolves to a boolean indicating whether the removal was successful.
   */
  function removeProvider(provider: ProviderId) {
    return saveProvider(provider, providerResetUpdate(provider), "removed");
  }

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
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
  };
}
