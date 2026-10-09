import { useCallback, useEffect, useRef, useState } from "react";
import { NavigationGuard, type ImportGuard } from "../routes/navigation-guard";

const historyKey = "receiptTrackerIndex";
const readLocation = () => ({
  pathname: window.location.pathname,
  search: window.location.search,
});

/**
 * Custom hook for managing import navigation within the application.
 * Provides state and functions for handling navigation guards, confirmation dialogs, and discard actions.
 * @returns An object containing the current location, navigation guard, and functions for managing import navigation.
 */
export function useImportNavigation() {
  const [location, setLocation] = useState(readLocation);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const discardPending = useRef(false);
  const [navigation] = useState(() => {
    const index = window.history.state?.[historyKey] ?? 0;
    window.history.replaceState(
      { ...window.history.state, [historyKey]: index },
      "",
    );
    return new NavigationGuard(
      {
        read: () => ({
          url: window.location.pathname + window.location.search,
          index: window.history.state?.[historyKey] ?? 0,
        }),
        push: (url, nextIndex) =>
          window.history.pushState({ [historyKey]: nextIndex }, "", url),
        go: (delta) => window.history.go(delta),
        changed: () => setLocation(readLocation()),
      },
      () => setConfirming(true),
    );
  });

  // Effect for handling browser navigation events (popstate and beforeunload).
  useEffect(() => {
    const pop = () => navigation.pop();
    const unload = (event: BeforeUnloadEvent) => {
      if (!navigation.shouldWarnBeforeUnload()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
    };
  }, [navigation]);
  const registerGuard = useCallback(
    (value: ImportGuard | null) => {
      navigation.register(value);
    },
    [navigation],
  );

  // Function for confirming the discard action.
  async function confirm() {
    if (discardPending.current) return;
    discardPending.current = true;
    setDiscarding(true);
    try {
      if (!(await navigation.confirm())) navigation.stay();
      setConfirming(false);
    } finally {
      discardPending.current = false;
      setDiscarding(false);
    }
  }

  // Function for staying on the current page without discarding changes.
  function stay() {
    if (discardPending.current) return;
    navigation.stay();
    setConfirming(false);
  }

  // Function for handling the successful save of an import.
  function saved(id: number) {
    void navigation.saved(id);
  }

  return {
    location,
    navigation,
    registerGuard,
    confirming,
    discarding,
    confirm,
    stay,
    saved,
  };
}
