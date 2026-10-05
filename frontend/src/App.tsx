import { useEffect, useState } from "react";
import LegacyImportApp from "./LegacyImportApp";
import AppShell from "./components/layout/AppShell";
import PlaceholderPage from "./pages/PlaceholderPage";
import SettingsPage from "./pages/SettingsPage";
import { resolveRoute } from "./routes/routing";
import "./App.css";

// Main application component.
function App() {
  const [route, setRoute] = useState(() =>
    resolveRoute(window.location.pathname, window.location.search),
  );
  // Effect for handling browser navigation events (back/forward buttons).
  useEffect(() => {
    const onPopState = () =>
      setRoute(resolveRoute(window.location.pathname, window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Function for navigating to a different section of the application.
  function navigate(section: string) {
    window.history.pushState(null, "", `/${section}`);
    setRoute(resolveRoute(window.location.pathname, window.location.search));
  }

  return route === "legacy" ? (
    <div className="legacy-import">
      <LegacyImportApp />
    </div>
  ) : (
    <AppShell route={route} navigate={navigate}>
      {route === "settings" ? (
        <SettingsPage />
      ) : (
        <PlaceholderPage route={route} />
      )}
    </AppShell>
  );
}

export default App;
