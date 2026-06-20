import { useCallback, useEffect, useState } from "react";
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

type BusyOperation = "catalog" | "load" | "command" | "page" | "save" | "note" | null;

type ConfirmState = {
  message: string;
  resolve: (confirmed: boolean) => void;
};

export function useFractalSession() {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPageChanges, setHasUnsavedPageChanges] = useState(false);
  const [busyOperation, setBusyOperation] = useState<BusyOperation>("catalog");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const isBusy = busyOperation !== null;
  const busy = {
    isLoadingCatalog: busyOperation === "catalog",
    isLoadingProject: busyOperation === "load",
    isMutatingNote: busyOperation === "note",
    isMutatingPage: busyOperation === "page",
    isRunningCommand: busyOperation === "command",
    isSaving: busyOperation === "save"
  }; 

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, resolve });
    });
  }, []);

  const answerConfirm = useCallback(
    (confirmed: boolean) => {
      confirmState?.resolve(confirmed);
      setConfirmState(null);
    },
    [confirmState]
  );

  const withBusy = useCallback(async <T,>(operation: BusyOperation, action: () => Promise<T>) => {
    setBusyOperation(operation);
    setError(null);

    try {
      return await action();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      return null;
    } finally {
      setBusyOperation(null);
    }
  }, []);

  const saveProjectPage = useCallback((project: FractalProject) => {
    return fractalClient.savePage(project, {
      bodyHtml: project.activePageBodyHtml,
      summary: project.activePageSummary ?? "",
      tags: project.activePageTags,
      title: project.activePageTitle
    });
  }, []);

  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", () => fractalClient.listProjects());
    if (catalog) setProjectCatalog(catalog);
  }, [withBusy]);

  const loadProject = useCallback(
    async (action: () => Promise<FractalProject>) => {
      const nextProject = await withBusy("load", action);
      if (!nextProject) return;
      setActiveProject(nextProject);
      setCommandResult(null);
      setHasUnsavedPageChanges(false);
    },
    [withBusy]
  );

  const runProjectCommand = useCallback(
    async (action: (project: FractalProject) => Promise<FractalCommandResult>) => {
      if (!activeProject) return;
      const result = await withBusy("command", () => action(activeProject));
      if (result) setCommandResult(result);
    },
    [activeProject, withBusy]
  );

  const openProjectPage = useCallback(
    async (pagePath: string) => {
      if (!activeProject || pagePath === activeProject.activePagePath || isBusy) return;
      if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and open another page?"))) return;

      const nextProject = await withBusy("page", () => fractalClient.openPage(activeProject, pagePath));
      if (!nextProject) return;
      setActiveProject(nextProject);
      setCommandResult(null);
      setHasUnsavedPageChanges(false);
    },
    [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]
  );

  const updateActivePageTitle = useCallback((title: string) => {
    setActiveProject((project) => (project ? { ...project, activePageTitle: title } : project));
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const updateActivePageBodyHtml = useCallback((bodyHtml: string) => {
    setActiveProject((project) => (project ? { ...project, activePageBodyHtml: bodyHtml } : project));
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const updateActivePageSummary = useCallback((summary: string) => {
    setActiveProject((project) => (project ? { ...project, activePageSummary: summary } : project));
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const updateActivePageTags = useCallback((tags: string[]) => {
    setActiveProject((project) => (project ? { ...project, activePageTags: tags } : project));
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const saveActivePage = useCallback(async () => {
    if (!activeProject || !hasUnsavedPageChanges || isBusy) return;
    const pagePath = activeProject.activePagePath;
    const nextProject = await withBusy("save", () => saveProjectPage(activeProject));
    if (!nextProject) return;
    setActiveProject(nextProject);
    setHasUnsavedPageChanges(false);
    setCommandResult({ ok: true, message: "Page saved and synced.", details: pagePath });
  }, [activeProject, hasUnsavedPageChanges, isBusy, saveProjectPage, withBusy]);

  const withSavedPageIfNeeded = useCallback(async () => {
    if (!activeProject) return null;
    return hasUnsavedPageChanges ? saveProjectPage(activeProject) : activeProject;
  }, [activeProject, hasUnsavedPageChanges, saveProjectPage]);

  const addActivePageNote = useCallback(
    async (trigger: string, content: string) => {
      if (!activeProject || isBusy) return;
      const trimmedTrigger = trigger.trim();
      if (!trimmedTrigger) return;
      const nextProject = await withBusy("note", async () => {
        const savedProject = await withSavedPageIfNeeded();
        return savedProject ? fractalClient.addNote(savedProject, trimmedTrigger, content) : null;
      });
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Note added.", details: trimmedTrigger });
    },
    [activeProject, isBusy, withBusy, withSavedPageIfNeeded]
  );

  const updateActivePageNote = useCallback(
    async (note: FractalNote, content: string) => {
      if (!activeProject || isBusy) return;
      const nextProject = await withBusy("note", async () => {
        const savedProject = await withSavedPageIfNeeded();
        return savedProject ? fractalClient.updateNote(savedProject, note, content) : null;
      });
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Note updated.", details: note.label });
    },
    [activeProject, isBusy, withBusy, withSavedPageIfNeeded]
  );

  const deleteActivePageNote = useCallback(
    async (note: FractalNote) => {
      if (!activeProject || isBusy) return;
      const nextProject = await withBusy("note", async () => {
        const savedProject = await withSavedPageIfNeeded();
        return savedProject ? fractalClient.deleteNote(savedProject, note) : null;
      });
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Note deleted.", details: note.label });
    },
    [activeProject, isBusy, withBusy, withSavedPageIfNeeded]
  );

  const createProjectPage = useCallback(
    async (pagePath: string) => {
      if (!activeProject || isBusy) return;
      const trimmedPagePath = pagePath.trim();
      if (!trimmedPagePath) return;
      if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and create a new page?"))) return;
      const nextProject = await withBusy("page", () => fractalClient.createPage(activeProject, trimmedPagePath));
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page created.", details: nextProject.activePagePath });
    },
    [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]
  );

  const renameProjectPage = useCallback(
    async (pagePath: string, nextPagePath: string) => {
      if (!activeProject || isBusy) return;
      const trimmedNextPagePath = nextPagePath.trim();
      if (!trimmedNextPagePath || trimmedNextPagePath === pagePath) return;
      if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and rename this page?"))) return;
      const nextProject = await withBusy("page", () => fractalClient.renamePage(activeProject, pagePath, trimmedNextPagePath));
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page renamed.", details: `${pagePath} -> ${trimmedNextPagePath}` });
    },
    [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]
  );

  const deleteProjectPage = useCallback(
    async (pagePath: string) => {
      if (!activeProject || isBusy) return;
      const prompt = hasUnsavedPageChanges
        ? `Delete ${pagePath}? Unsaved changes will be discarded.`
        : `Delete ${pagePath}?`;
      if (!(await confirm(prompt))) return;
      const nextProject = await withBusy("page", () => fractalClient.deletePage(activeProject, pagePath));
      if (!nextProject) return;
      setActiveProject(nextProject);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page deleted.", details: pagePath });
    },
    [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]
  );

  const dismissStatus = useCallback(() => {
    setCommandResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    void refreshProjectCatalog();
  }, [refreshProjectCatalog]);

  return {
    activeProject,
    busy,
    busyOperation,
    commandResult,
    confirmDialog: confirmState ? { message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    hasUnsavedPageChanges,
    isBusy,
    projectCatalog,
    addActivePageNote,
    createProjectPage,
    deleteActivePageNote,
    deleteProjectPage,
    dismissStatus,
    loadProject,
    openProjectPage,
    refreshProjectCatalog,
    renameProjectPage,
    runProjectCommand,
    saveActivePage,
    updateActivePageBodyHtml,
    updateActivePageNote,
    updateActivePageSummary,
    updateActivePageTags,
    updateActivePageTitle
  };
}
