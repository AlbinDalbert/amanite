import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import UniversalContextMenu, {
  type UniversalContextMenuAction
} from "@/components/ui/UniversalContextMenu";
import StartScreen from "@/features/project-open/components/StartScreen";
import { fractalClient } from "@/lib/fractal/client";
import { useFractalSession } from "./useFractalSession";
import { useAppearanceSettings } from "./useAppearanceSettings";

const SettingsScreen = lazy(() => import("@/features/settings/components/SettingsScreen"));
const Workspace = lazy(() => import("@/features/workspace/components/Workspace"));

function AppLoading() {
  return <div aria-label="Loading Amanite" className="app-loading"><span>Amanite</span><i /></div>;
}

function ConfirmDialog({
  confirmLabel,
  message,
  onAnswer
}: {
  confirmLabel: string;
  message: string;
  onAnswer: (confirmed: boolean) => void;
}) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    continueButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onAnswer(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        onAnswer(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onAnswer]);

  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation">
      <section
        aria-labelledby="confirm-title"
        aria-modal="true"
        className="create-page-dialog confirm-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <p className="dialog-kicker">Confirm operation</p>
          <h2 id="confirm-title">Proceed?</h2>
        </div>
        <p className="dialog-note">{message}</p>
        <div className="dialog-actions">
          <button
            className="ghost-action"
            onClick={() => onAnswer(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary-action"
            onClick={() => onAnswer(true)}
            ref={continueButtonRef}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const appearance = useAppearanceSettings();
  const session = useFractalSession();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [hasWorkspaceUnsavedChanges, setHasWorkspaceUnsavedChanges] = useState(false);
  const allowCloseRef = useRef(false);
  const restoredSessionRef = useRef(false);
  const {
    activeProject,
    commandResult,
    confirmDialog,
    error,
    isBusy,
    projectCatalog
  } = session;
  const hasWorkspaceUnsavedRef = useRef(hasWorkspaceUnsavedChanges);
  const saveWorkspaceRef = useRef<(() => Promise<boolean>) | null>(null);
  hasWorkspaceUnsavedRef.current = hasWorkspaceUnsavedChanges;

  const registerWorkspace = useCallback((dirty: boolean, save: (() => Promise<boolean>) | null) => {
    hasWorkspaceUnsavedRef.current = dirty;
    setHasWorkspaceUnsavedChanges(dirty);
    saveWorkspaceRef.current = save;
  }, []);

  const requestWindowClose = useCallback(async () => {
    if (hasWorkspaceUnsavedRef.current && saveWorkspaceRef.current && !(await saveWorkspaceRef.current())) return;
    allowCloseRef.current = true;
    if ("__TAURI_INTERNALS__" in window) await getCurrentWindow().close();
    else window.close();
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();

    void appWindow.onCloseRequested(async (event) => {
      if (allowCloseRef.current || !hasWorkspaceUnsavedRef.current) return;
      event.preventDefault();
      if (saveWorkspaceRef.current && !(await saveWorkspaceRef.current())) return;
      allowCloseRef.current = true;
      await appWindow.close();
    }).then((removeListener) => {
      if (disposed) removeListener();
      else unlisten = removeListener;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (restoredSessionRef.current || !appearance.settings.restoreLastSession || !projectCatalog || activeProject) return;
    restoredSessionRef.current = true;
    try {
      const stored = JSON.parse(localStorage.getItem("amanite.last-session.v1") ?? "null") as { pagePath?: string; projectRoot?: string } | null;
      if (!stored?.projectRoot) return;
      void session.loadProject(async () => {
        const project = await fractalClient.openProjectPath(stored.projectRoot!);
        return stored.pagePath && project.pages.some((page) => page.path === stored.pagePath)
          ? fractalClient.openPage(project, stored.pagePath)
          : project;
      });
    } catch {
      // A stale session record should leave the start screen usable.
    }
  }, [activeProject, appearance.settings.restoreLastSession, projectCatalog, session]);

  const openProjectFolder = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const selected = await open({ directory: true, multiple: false, title: "Open Fractal project" });
    if (typeof selected === "string") await session.loadProject(() => fractalClient.openProjectPath(selected));
  }, [session]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasWorkspaceUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasWorkspaceUnsavedChanges]);

  const contextMenuActions: UniversalContextMenuAction[] = activeProject
    ? [
        {
          disabled: isBusy || !hasWorkspaceUnsavedChanges,
          label: "Save pages",
          title: hasWorkspaceUnsavedChanges ? "Save edited pages." : "No page changes to save.",
          onSelect: () => {
            if (saveWorkspaceRef.current) void saveWorkspaceRef.current();
          }
        },
        {
          disabled: isBusy,
          label: "Validate project",
          onSelect: () => void session.validateProject()
        }
      ]
    : [];

  return (
    <UniversalContextMenu actions={contextMenuActions}>
      {!activeProject ? (isSettingsOpen ? (
        <Suspense fallback={<AppLoading />}><SettingsScreen settings={appearance.settings} onChange={appearance.setSettings} onClose={() => setIsSettingsOpen(false)} onCloseRequest={() => void requestWindowClose()} /></Suspense>
      ) : (
        <StartScreen
          error={error}
          isBusy={isBusy}
          onCloseRequest={() => void requestWindowClose()}
          projectCatalog={projectCatalog}
          onCreateProject={(projectName) =>
            session.loadProject(() => fractalClient.createProject(projectName))
          }
          onOpenProject={(directoryName) =>
            session.loadProject(() => fractalClient.openProject(directoryName))
          }
          onOpenProjectFolder={() => void openProjectFolder()}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRefreshProjects={session.refreshProjectCatalog}
        />
      )) : (
        <>
          <div className={isSettingsOpen ? "workspace-view settings-hidden" : "workspace-view"}>
            <Suspense fallback={<AppLoading />}><Workspace
              commandResult={commandResult}
              error={error}
              isBusy={isBusy}
              project={activeProject}
              settings={appearance.settings}
              onCloseProject={session.closeProject}
              onCloseRequest={() => void requestWindowClose()}
              onCreatePage={session.createProjectPage}
              onCreateFolder={session.createProjectFolder}
              onDeletePage={session.deleteProjectPage}
              onDeleteFolder={session.deleteProjectFolder}
              onDuplicatePage={session.duplicateProjectPage}
              onDismissStatus={session.dismissStatus}
              onMovePage={session.moveProjectPage}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onImportNativePage={session.importNativePage}
              onProjectSnapshot={session.adoptProjectSnapshot}
              onRegisterWorkspace={registerWorkspace}
              onRequestConfirmation={session.requestConfirmation}
              onRevealPage={session.revealPage}
              onSearchProject={session.searchProject}
              onValidate={session.validateProject}
            /></Suspense>
          </div>
          {isSettingsOpen ? <Suspense fallback={null}><SettingsScreen settings={appearance.settings} onChange={appearance.setSettings} onClose={() => setIsSettingsOpen(false)} onCloseRequest={() => void requestWindowClose()} /></Suspense> : null}
        </>
      )}

      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
    </UniversalContextMenu>
  );
}

export default App;
