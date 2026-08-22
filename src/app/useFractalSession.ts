import { useCallback, useEffect, useState } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalProject, FractalProjectCatalog } from "@/lib/fractal/types";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type BusyOperation = "catalog" | "load" | "command" | "page" | "save" | null;
type ConfirmState = { message: string; resolve: (confirmed: boolean) => void };

export function useFractalSession() {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPageChanges, setHasUnsavedPageChanges] = useState(false);
  const [busyOperation, setBusyOperation] = useState<BusyOperation>("catalog");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const isBusy = busyOperation !== null;

  const confirm = useCallback((message: string) => new Promise<boolean>((resolve) => {
    setConfirmState({ message, resolve });
  }), []);

  const answerConfirm = useCallback((confirmed: boolean) => {
    confirmState?.resolve(confirmed);
    setConfirmState(null);
  }, [confirmState]);

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

  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", fractalClient.listProjects);
    if (catalog) setProjectCatalog(catalog);
  }, [withBusy]);

  const loadProject = useCallback(async (action: () => Promise<FractalProject>) => {
    const project = await withBusy("load", action);
    if (project) {
      setActiveProject(project);
      setCommandResult(null);
      setHasUnsavedPageChanges(false);
    }
  }, [withBusy]);

  const openProjectPage = useCallback(async (pagePath: string) => {
    if (!activeProject || pagePath === activeProject.activePagePath || isBusy) return;
    if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and open another page?"))) return;
    const project = await withBusy("page", () => fractalClient.openPage(activeProject, pagePath));
    if (project) {
      setActiveProject(project);
      setHasUnsavedPageChanges(false);
      setCommandResult(null);
    }
  }, [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const updateActivePageSource = useCallback((source: string) => {
    setActiveProject((project) => project ? { ...project, activePageSource: source } : project);
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const saveActivePage = useCallback(async () => {
    if (!activeProject?.activePagePath || activeProject.activePageSource == null || !hasUnsavedPageChanges || isBusy) return;
    const path = activeProject.activePagePath;
    const project = await withBusy("save", () => fractalClient.writePage(activeProject, activeProject.activePageSource!));
    if (project) {
      setActiveProject(project);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page saved.", details: path });
    }
  }, [activeProject, hasUnsavedPageChanges, isBusy, withBusy]);

  const createProjectPage = useCallback(async (title: string) => {
    if (!activeProject || isBusy || !title.trim()) return;
    if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and create a page?"))) return;
    const project = await withBusy("page", () => fractalClient.createPage(activeProject, title.trim()));
    if (project) {
      setActiveProject(project);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page created.", details: project.activePagePath });
    }
  }, [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const moveProjectPage = useCallback(async (pagePath: string, destination: string) => {
    if (!activeProject || isBusy || !destination.trim() || destination.trim() === pagePath) return;
    if (hasUnsavedPageChanges && !(await confirm("Discard unsaved changes and move this page?"))) return;
    const project = await withBusy("page", () => fractalClient.movePage(activeProject, pagePath, destination.trim()));
    if (project) {
      setActiveProject(project);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page moved.", details: `${pagePath} → ${destination.trim()}` });
    }
  }, [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const deleteProjectPage = useCallback(async (pagePath: string) => {
    if (!activeProject || isBusy) return;
    const suffix = hasUnsavedPageChanges ? " Unsaved changes will be discarded." : "";
    if (!(await confirm(`Delete ${pagePath}?${suffix}`))) return;
    const project = await withBusy("page", () => fractalClient.deletePage(activeProject, pagePath));
    if (project) {
      setActiveProject(project);
      setHasUnsavedPageChanges(false);
      setCommandResult({ ok: true, message: "Page deleted.", details: pagePath });
    }
  }, [activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const validateProject = useCallback(async () => {
    if (!activeProject) return;
    const result = await withBusy("command", () => fractalClient.validateProject(activeProject));
    if (result) setCommandResult(result);
  }, [activeProject, withBusy]);

  const dismissStatus = useCallback(() => { setCommandResult(null); setError(null); }, []);

  useEffect(() => { void refreshProjectCatalog(); }, [refreshProjectCatalog]);

  return {
    activeProject,
    commandResult,
    confirmDialog: confirmState ? { message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    hasUnsavedPageChanges,
    isBusy,
    projectCatalog,
    createProjectPage,
    deleteProjectPage,
    dismissStatus,
    loadProject,
    moveProjectPage,
    openProjectPage,
    refreshProjectCatalog,
    saveActivePage,
    updateActivePageSource,
    validateProject
  };
}
