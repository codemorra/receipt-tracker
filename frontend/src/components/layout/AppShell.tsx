import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Route, NavigationTarget } from "../../routes/routing";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

// Props for the AppShell component.
interface Props {
  route: Route;
  navigate: (section: NavigationTarget) => void;
  children: ReactNode;
}

/**
 * AppShell component for the main layout of the application.
 * @param route The current route of the application.
 * @param navigate Callback function to navigate to a different section.
 * @param children The content to be rendered within the main area of the layout.
 */
export default function AppShell({ route, navigate, children }: Props) {
  const { t } = useTranslation();
  const drawer = useRef<HTMLDialogElement>(null);
  return (
    <div className="app-shell min-h-dvh bg-canvas bg-(image:--canvas-gradient) text-foreground **:focus-visible:outline-2 **:focus-visible:outline-offset-4 **:focus-visible:outline-accent">
      <a
        className="fixed top-3 left-4 z-50 translate-y-[-200%] rounded-lg border border-shell bg-surface p-3 text-foreground focus:translate-y-0"
        href="#page-content"
      >
        {t("common.actions.skipToContent")}
      </a>
      <Sidebar route={route} navigate={navigate} drawer={drawer} />
      <div className="lg:ml-68">
        <Topbar onOpenNavigation={() => drawer.current?.showModal()} />
        <main
          id="page-content"
          tabIndex={-1}
          className="mx-auto max-w-384 px-5 py-10 lg:px-10 lg:py-12"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
