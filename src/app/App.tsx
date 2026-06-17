import { useEffect, useState } from "react";
import UniversalContextMenu, {
  type UniversalContextMenuAction
} from "@/components/ui/UniversalContextMenu";
import StartScreen from "@/features/project-open/components/StartScreen";
import Workspace from "@/features/workspace/components/Workspace";
import { fractalClient } from "@/lib/fractal/client";
import type {
  FractalCommandResult,
  FractalNote,
  FractalProject,
  FractalProjectCatalog
} from "@/lib/fractal/types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPageChanges, setHasUnsavedPageChanges] = useState(false);
  const [isBusy, setIsBusy] = useState(true);

  async function refreshProjectCatalog() {
    setIsBusy(true);
    setError(null);

    try {
      setProjectCatalog(await fractalClient.listProjects());
    } catch (catalogError) {
      setError(getErrorMessage(catalogError));
    } finally {
      setIsBusy(false);
    }
  }

  async function loadProject(action: () => Promise<FractalProject>) {
    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await action();
      setActiveProject(nextProject);
      setCommandResult(null);
      setHasUnsavedPageChanges(false);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsBusy(false);
    }
  }

  async function runProjectCommand(
    action: (project: FractalProject) => Promise<FractalCommandResult>
  ) {
    if (!activeProject) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      setCommandResult(await action(activeProject));
    } catch (commandError) {
      setError(getErrorMessage(commandError));
    } finally {
      setIsBusy(false);
    }
  }

  async function openProjectPage(pagePath: string) {
    if (!activeProject || pagePath === activeProject.activePagePath || isBusy) {
      return;
    }

    if (
      hasUnsavedPageChanges &&
      !window.confirm("Discard unsaved changes and open another page?")
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await fractalClient.openPage(activeProject, pagePath);
      setActiveProject(nextProject);
      setCommandResult(null);
      setHasUnsavedPageChanges(false);
    } catch (openError) {
      setError(getErrorMessage(openError));
    } finally {
      setIsBusy(false);
    }
  }

  function updateActivePageTitle(title: string) {
    setActiveProject((currentProject) =>
      currentProject ? { ...currentProject, activePageTitle: title } : currentProject
    );
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }

  function updateActivePageBodyHtml(bodyHtml: string) {
    setActiveProject((currentProject) =>
      currentProject ? { ...currentProject, activePageBodyHtml: bodyHtml } : currentProject
    );
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }

  function updateActivePageSummary(summary: string) {
    setActiveProject((currentProject) =>
      currentProject
        ? {
            ...currentProject,
            activePageSummary: summary
          }
        : currentProject
    );
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }

  function updateActivePageTags(tags: string[]) {
    setActiveProject((currentProject) =>
      currentProject ? { ...currentProject, activePageTags: tags } : currentProject
    );
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }

  async function saveProjectPage(project: FractalProject) {
    return fractalClient.savePage(project, {
      bodyHtml: project.activePageBodyHtml,
      summary: project.activePageSummary ?? "",
      tags: project.activePageTags,
      title: project.activePageTitle
    });
  }

  async function saveActivePage() {
    if (!activeProject || !hasUnsavedPageChanges || isBusy) {
      return;
    }

    const pagePath = activeProject.activePagePath;

    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await saveProjectPage(activeProject);
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Page saved and synced.",
        details: pagePath
      });
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsBusy(false);
    }
  }

  async function addActivePageNote(trigger: string, content: string) {
    if (!activeProject || isBusy) {
      return;
    }

    const trimmedTrigger = trigger.trim();
    if (!trimmedTrigger) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const savedProject = hasUnsavedPageChanges
        ? await saveProjectPage(activeProject)
        : activeProject;
      const nextProject = await fractalClient.addNote(savedProject, trimmedTrigger, content);

      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Note added.",
        details: trimmedTrigger
      });
    } catch (noteError) {
      setError(getErrorMessage(noteError));
    } finally {
      setIsBusy(false);
    }
  }

  async function updateActivePageNote(note: FractalNote, content: string) {
    if (!activeProject || isBusy) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const savedProject = hasUnsavedPageChanges
        ? await saveProjectPage(activeProject)
        : activeProject;
      const nextProject = await fractalClient.updateNote(savedProject, note, content);

      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Note updated.",
        details: note.label
      });
    } catch (noteError) {
      setError(getErrorMessage(noteError));
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteActivePageNote(note: FractalNote) {
    if (!activeProject || isBusy) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const savedProject = hasUnsavedPageChanges
        ? await saveProjectPage(activeProject)
        : activeProject;
      const nextProject = await fractalClient.deleteNote(savedProject, note);

      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Note deleted.",
        details: note.label
      });
    } catch (noteError) {
      setError(getErrorMessage(noteError));
    } finally {
      setIsBusy(false);
    }
  }

  async function createProjectPage(pagePath: string) {
    if (!activeProject || isBusy) {
      return;
    }

    const trimmedPagePath = pagePath.trim();
    if (trimmedPagePath.length === 0) {
      return;
    }

    if (
      hasUnsavedPageChanges &&
      !window.confirm("Discard unsaved changes and create a new page?")
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await fractalClient.createPage(activeProject, trimmedPagePath);
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Page created.",
        details: nextProject.activePagePath
      });
    } catch (createError) {
      setError(getErrorMessage(createError));
    } finally {
      setIsBusy(false);
    }
  }

  async function renameProjectPage(pagePath: string, nextPagePath: string) {
    if (!activeProject || isBusy) {
      return;
    }

    const trimmedNextPagePath = nextPagePath.trim();
    if (trimmedNextPagePath.length === 0 || trimmedNextPagePath === pagePath) {
      return;
    }

    if (
      hasUnsavedPageChanges &&
      !window.confirm("Discard unsaved changes and rename this page?")
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await fractalClient.renamePage(
        activeProject,
        pagePath,
        trimmedNextPagePath
      );
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Page renamed.",
        details: `${pagePath} -> ${trimmedNextPagePath}`
      });
    } catch (renameError) {
      setError(getErrorMessage(renameError));
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteProjectPage(pagePath: string) {
    if (!activeProject || isBusy) {
      return;
    }

    const prompt = hasUnsavedPageChanges
      ? `Delete ${pagePath}? Unsaved changes will be discarded.`
      : `Delete ${pagePath}?`;

    if (!window.confirm(prompt)) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const nextProject = await fractalClient.deletePage(activeProject, pagePath);
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({
        ok: true,
        message: "Page deleted.",
        details: pagePath
      });
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setIsBusy(false);
    }
  }

  function dismissStatus() {
    setCommandResult(null);
    setError(null);
  }

  useEffect(() => {
    void refreshProjectCatalog();
  }, []);

  const contextMenuActions: UniversalContextMenuAction[] = activeProject
    ? [
        {
          disabled: isBusy || !hasUnsavedPageChanges,
          label: "Save page + sync",
          title: hasUnsavedPageChanges
            ? "Save the active page and run Fractal sync."
            : "No page changes to save.",
          onSelect: () => void saveActivePage()
        },
        {
          disabled: isBusy,
          label: "Validate project",
          onSelect: () => void runProjectCommand(fractalClient.validateProject)
        },
        {
          disabled: isBusy,
          label: "Build index",
          onSelect: () => void runProjectCommand(fractalClient.buildIndex)
        }
      ]
    : [];

  if (!activeProject) {
    return (
      <UniversalContextMenu actions={contextMenuActions}>
        <StartScreen
          error={error}
          isBusy={isBusy}
          projectCatalog={projectCatalog}
          onCreateProject={(projectName) =>
            loadProject(() => fractalClient.createProject(projectName))
          }
          onOpenProject={(directoryName) =>
            loadProject(() => fractalClient.openProject(directoryName))
          }
          onRefreshProjects={refreshProjectCatalog}
        />
      </UniversalContextMenu>
    );
  }

  return (
    <UniversalContextMenu actions={contextMenuActions}>
      <Workspace
        commandResult={commandResult}
        error={error}
        hasUnsavedPageChanges={hasUnsavedPageChanges}
        isBusy={isBusy}
        project={activeProject}
        onBuildIndex={() => runProjectCommand(fractalClient.buildIndex)}
        onChangePageBodyHtml={updateActivePageBodyHtml}
        onChangePageSummary={updateActivePageSummary}
        onChangePageTags={updateActivePageTags}
        onChangePageTitle={updateActivePageTitle}
        onCreatePage={createProjectPage}
        onDeletePage={deleteProjectPage}
        onAddNote={addActivePageNote}
        onDeleteNote={deleteActivePageNote}
        onDismissStatus={dismissStatus}
        onOpenPage={openProjectPage}
        onRenamePage={renameProjectPage}
        onUpdateNote={updateActivePageNote}
        onSavePage={saveActivePage}
        onValidate={() => runProjectCommand(fractalClient.validateProject)}
      />
    </UniversalContextMenu>
  );
}

export default App;
