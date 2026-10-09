import { useTranslation } from "react-i18next";
import { useImportNavigation } from "./hooks/useImportNavigation";
import ConfirmDialog from "./components/ui/ConfirmDialog";
import AppShell from "./components/layout/AppShell";
import PlaceholderPage from "./pages/PlaceholderPage";
import SettingsPage from "./pages/SettingsPage";
import HomePage from "./pages/HomePage";
import ImportPage from "./pages/ImportPage";
import SavedReceiptPage from "./pages/SavedReceiptPage";
import ReceiptsPage from "./pages/ReceiptsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import WarrantiesPage from "./pages/WarrantiesPage";
import {
  receiptIdFromSearch,
  resolveRoute,
  type NavigationTarget,
} from "./routes/routing";
import "./App.css";

// Main application component.
function App() {
  const { t } = useTranslation();
  const workflow = useImportNavigation();
  const { location } = workflow;
  const route = resolveRoute(location.pathname, location.search);
  const receiptId = receiptIdFromSearch(location.search);

  /**
   * Navigates to the specified URL within the application.
   * @param url - The target URL to navigate to.
   */
  function navigateTo(url: string) {
    workflow.navigation.navigate(url);
  }

  /**
   * Navigates to the specified section within the application.
   * @param section - The target section to navigate to.
   */
  function navigate(section: NavigationTarget) {
    navigateTo(section === "home" ? "/" : `/${section}`);
  }

  return (
    <>
      <AppShell route={route} navigate={navigate}>
        {route === "home" ? (
          <HomePage navigate={navigate} />
        ) : route === "settings" ? (
          <SettingsPage />
        ) : route === "import" ? (
          receiptId !== null ? (
            <SavedReceiptPage
              key={receiptId}
              receiptId={receiptId}
              onNewImport={() => navigateTo("/import")}
            />
          ) : (
            <ImportPage
              onSaved={workflow.saved}
              registerGuard={workflow.registerGuard}
              onDiscard={() => workflow.navigation.requestDiscard()}
            />
          )
        ) : route === "receipts" ? (
          <ReceiptsPage />
        ) : route === "analytics" ? (
          <AnalyticsPage search={location.search} navigate={navigateTo} />
        ) : route === "warranties" ? (
          <WarrantiesPage />
        ) : (
          <PlaceholderPage route={route} />
        )}
      </AppShell>
      {workflow.confirming && (
        <ConfirmDialog
          title={t("pages.import.discard.title")}
          message={t("pages.import.discard.message")}
          confirmLabel={t(
            workflow.discarding
              ? "pages.import.discard.discarding"
              : "pages.import.discard.action",
          )}
          cancelLabel={t("pages.import.discard.back")}
          busy={workflow.discarding}
          onConfirm={() => void workflow.confirm()}
          onCancel={workflow.stay}
        />
      )}
    </>
  );
}

export default App;
