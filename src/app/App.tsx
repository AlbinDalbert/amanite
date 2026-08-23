import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import UniversalContextMenu, {
  type UniversalContextMenuAction
} from "@/components/ui/UniversalContextMenu";
import StartScreen from "@/features/project-open/components/StartScreen";
import SettingsScreen from "@/features/settings/components/SettingsScreen";
import Workspace from "@/features/workspace/components/Workspace";
import { fractalClient } from "@/lib/fractal/client";
import { useFractalSession } from "./useFractalSession";
import { useAppearanceSettings } from "./useAppearanceSettings";

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
  const session = useFractalSession();
  const appearance = useAppearanceSettings();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const allowCloseRef = useRef(false);
  const {
    activeProject,
    commandResult,
    confirmDialog,
    error,
    hasUnsavedPageChanges,
    isBusy,
    projectCatalog
  } = session;
  const hasUnsavedRef = useRef(hasUnsavedPageChanges);
  const requestConfirmationRef = useRef(session.requestConfirmation);
  const discardActiveDraftRef = useRef(session.discardActiveDraft);
  const saveActivePageRef = useRef(session.saveActivePage);
  hasUnsavedRef.current = hasUnsavedPageChanges;
  requestConfirmationRef.current = session.requestConfirmation;
  discardActiveDraftRef.current = session.discardActiveDraft;
  saveActivePageRef.current = session.saveActivePage;

  const requestWindowClose = useCallback(async () => {
    if (hasUnsavedRef.current) {
      const shouldDiscard = await requestConfirmationRef.current("Close Amanite and discard unsaved changes?", "Discard and close");
      if (!shouldDiscard) return;
      discardActiveDraftRef.current();
    }
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
      if (allowCloseRef.current || !hasUnsavedRef.current) return;
      event.preventDefault();
      const shouldDiscard = await requestConfirmationRef.current("Close Amanite and discard unsaved changes?", "Discard and close");
      if (!shouldDiscard) return;
      discardActiveDraftRef.current();
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
    function handleSaveShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveActivePageRef.current();
    }
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, []);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedPageChanges) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedPageChanges]);

  const contextMenuActions: UniversalContextMenuAction[] = activeProject
    ? [
        {
          disabled: isBusy || !hasUnsavedPageChanges,
          label: "Save page",
          title: hasUnsavedPageChanges ? "Save the active page." : "No page changes to save.",
          onSelect: () => void session.saveActivePage()
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
      {isSettingsOpen ? (
        <SettingsScreen
          settings={appearance.settings}
          onChange={appearance.setSettings}
          onClose={() => setIsSettingsOpen(false)}
          onCloseRequest={() => void requestWindowClose()}
        />
      ) : !activeProject ? (
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
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRefreshProjects={session.refreshProjectCatalog}
        />
      ) : (
        <Workspace
          commandResult={commandResult}
          error={error}
          hasUnsavedPageChanges={hasUnsavedPageChanges}
          isBusy={isBusy}
          project={activeProject}
          saveState={session.saveState}
          onChangePageSource={session.updateActivePageSource}
          onCloseRequest={() => void requestWindowClose()}
          onCreatePage={session.createProjectPage}
          onCreateFolder={session.createProjectFolder}
          onDeletePage={session.deleteProjectPage}
          onDeleteFolder={session.deleteProjectFolder}
          onDismissStatus={session.dismissStatus}
          onMovePage={session.moveProjectPage}
          onOpenPage={session.openProjectPage}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onSavePage={session.saveActivePage}
          onValidate={session.validateProject}
        />
      )}

      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
    </UniversalContextMenu>
  );
}

export default App;
