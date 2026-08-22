import { useEffect, useRef } from "react";
import UniversalContextMenu, {
  type UniversalContextMenuAction
} from "@/components/ui/UniversalContextMenu";
import StartScreen from "@/features/project-open/components/StartScreen";
import Workspace from "@/features/workspace/components/Workspace";
import { fractalClient } from "@/lib/fractal/client";
import { useFractalSession } from "./useFractalSession";

function ConfirmDialog({
  message,
  onAnswer
}: {
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
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const session = useFractalSession();
  const {
    activeProject,
    commandResult,
    confirmDialog,
    error,
    hasUnsavedPageChanges,
    isBusy,
    projectCatalog
  } = session;

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
      {!activeProject ? (
        <StartScreen
          error={error}
          isBusy={isBusy}
          projectCatalog={projectCatalog}
          onCreateProject={(projectName) =>
            session.loadProject(() => fractalClient.createProject(projectName))
          }
          onOpenProject={(directoryName) =>
            session.loadProject(() => fractalClient.openProject(directoryName))
          }
          onRefreshProjects={session.refreshProjectCatalog}
        />
      ) : (
        <Workspace
          commandResult={commandResult}
          error={error}
          hasUnsavedPageChanges={hasUnsavedPageChanges}
          isBusy={isBusy}
          project={activeProject}
          onChangePageSource={session.updateActivePageSource}
          onCreatePage={session.createProjectPage}
          onDeletePage={session.deleteProjectPage}
          onDismissStatus={session.dismissStatus}
          onMovePage={session.moveProjectPage}
          onOpenPage={session.openProjectPage}
          onSavePage={session.saveActivePage}
          onValidate={session.validateProject}
        />
      )}

      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
    </UniversalContextMenu>
  );
}

export default App;
