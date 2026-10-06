import { useEffect, useState } from "react";
import AppShell from "./components/layout/AppShell";
import PlaceholderPage from "./pages/PlaceholderPage";
import SettingsPage from "./pages/SettingsPage";
import ImportPage from "./pages/ImportPage";
import SavedReceiptPage from "./pages/SavedReceiptPage";
import ReceiptsPage from "./pages/ReceiptsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import { receiptIdFromSearch, resolveRoute } from "./routes/routing";
import "./App.css";

// Main application component.
function App() {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const route = resolveRoute(location.pathname, location.search);
  const receiptId = receiptIdFromSearch(location.search);
  useEffect(() => {
    const onPopState = () =>
      setLocation({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  function navigateTo(url: string) {
    window.history.pushState(null, "", url);
    setLocation({
      pathname: window.location.pathname,
      search: window.location.search,
    });
  }
  function navigate(section: string) {
    navigateTo(`/${section}`);
  }

  return (
    <AppShell route={route} navigate={navigate}>
      {route === "settings" ? (
        <SettingsPage />
      ) : route === "import" ? (
        receiptId !== null ? (
          <SavedReceiptPage
            key={receiptId}
            receiptId={receiptId}
            onNewImport={() => navigateTo("/import")}
          />
        ) : (
          <ImportPage onSaved={(id) => navigateTo(`/import?receiptId=${id}`)} />
        )
      ) : route === "receipts" ? (
        <ReceiptsPage />
      ) : route === "analytics" ? (
        <AnalyticsPage search={location.search} navigate={navigateTo} />
      ) : (
        <PlaceholderPage route={route} />
      )}
    </AppShell>
  );
}

export default App;
