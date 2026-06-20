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
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onAnswer(false);
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
            ref={cancelButtonRef}
            type="button"
          >
            Cancel
          </button>
          <button className="primary-action" onClick={() => onAnswer(true)} type="button">
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
    busy,
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
          label: "Save page + sync",
          title: hasUnsavedPageChanges
            ? "Save the active page and run Fractal sync."
            : "No page changes to save.",
          onSelect: () => void session.saveActivePage()
        },
        {
          disabled: busy.isRunningCommand,
          label: "Validate project",
          onSelect: () => void session.runProjectCommand(fractalClient.validateProject)
        },
        {
          disabled: busy.isRunningCommand,
          label: "Build index",
          onSelect: () => void session.runProjectCommand(fractalClient.buildIndex)
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
          onBuildIndex={() => session.runProjectCommand(fractalClient.buildIndex)}
          onChangePageBodyHtml={session.updateActivePageBodyHtml}
          onChangePageSummary={session.updateActivePageSummary}
          onChangePageTags={session.updateActivePageTags}
          onChangePageTitle={session.updateActivePageTitle}
          onCreatePage={session.createProjectPage}
          onDeletePage={session.deleteProjectPage}
          onAddNote={session.addActivePageNote}
          onDeleteNote={session.deleteActivePageNote}
          onDismissStatus={session.dismissStatus}
          onOpenPage={session.openProjectPage}
          onRenamePage={session.renameProjectPage}
          onUpdateNote={session.updateActivePageNote}
          onSavePage={session.saveActivePage}
          onValidate={() => session.runProjectCommand(fractalClient.validateProject)}
        />
      )}

      {confirmDialog ? <ConfirmDialog {...confirmDialog} /> : null}
    </UniversalContextMenu>
  );
}

export default App;
