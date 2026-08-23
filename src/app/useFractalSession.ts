import { useCallback, useEffect, useRef, useState } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalProject, FractalProjectCatalog } from "@/lib/fractal/types";
import { clearPageDraft, readPageDraft, writePageDraft } from "./pageDrafts";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type BusyOperation = "catalog" | "load" | "command" | "page" | "save" | null;
type ConfirmState = { confirmLabel: string; message: string; resolve: (confirmed: boolean) => void };

export function useFractalSession() {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPageChanges, setHasUnsavedPageChanges] = useState(false);
  const [busyOperation, setBusyOperation] = useState<BusyOperation>("catalog");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const editRevisionRef = useRef(0);
  const isBusy = busyOperation !== null;

  const confirm = useCallback((message: string, confirmLabel = "Continue") => new Promise<boolean>((resolve) => {
    setConfirmState({ confirmLabel, message, resolve });
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

  const discardActiveDraft = useCallback(() => {
    if (activeProject?.activePagePath) {
      clearPageDraft(activeProject.rootPath, activeProject.activePagePath);
    }
  }, [activeProject]);

  const acceptLoadedProject = useCallback(async (project: FractalProject) => {
    const pagePath = project.activePagePath;
    const pageSource = project.activePageSource;
    const draft = pagePath && pageSource != null
      ? readPageDraft(project.rootPath, pagePath)
      : null;

    if (draft && draft.source !== pageSource) {
      const shouldRecover = await confirm(`Recover the unsaved draft for ${pagePath}?`, "Recover draft");
      if (shouldRecover) {
        editRevisionRef.current += 1;
        setActiveProject({ ...project, activePageSource: draft.source });
        setHasUnsavedPageChanges(true);
        setCommandResult({ ok: true, message: "Unsaved draft recovered.", details: pagePath });
        return;
      }
      clearPageDraft(project.rootPath, pagePath!);
    } else if (draft && pagePath) {
      clearPageDraft(project.rootPath, pagePath);
    }

    editRevisionRef.current = 0;
    setActiveProject(project);
    setCommandResult(null);
    setHasUnsavedPageChanges(false);
  }, [confirm]);

  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", fractalClient.listProjects);
    if (catalog) setProjectCatalog(catalog);
  }, [withBusy]);

  const loadProject = useCallback(async (action: () => Promise<FractalProject>) => {
    const project = await withBusy("load", action);
    if (project) {
      await acceptLoadedProject(project);
    }
  }, [acceptLoadedProject, withBusy]);

  const openProjectPage = useCallback(async (pagePath: string) => {
    if (!activeProject || pagePath === activeProject.activePagePath || isBusy) return;
    let discardCurrentDraft = false;
    if (hasUnsavedPageChanges) {
      if (!(await confirm("Discard unsaved changes and open another page?", "Discard changes"))) return;
      discardCurrentDraft = true;
    }
    const project = await withBusy("page", () => fractalClient.openPage(activeProject, pagePath));
    if (project) {
      if (discardCurrentDraft) discardActiveDraft();
      await acceptLoadedProject(project);
    }
  }, [acceptLoadedProject, activeProject, confirm, discardActiveDraft, hasUnsavedPageChanges, isBusy, withBusy]);

  const updateActivePageSource = useCallback((source: string) => {
    editRevisionRef.current += 1;
    setActiveProject((project) => project ? { ...project, activePageSource: source } : project);
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const saveActivePage = useCallback(async () => {
    if (!activeProject?.activePagePath || activeProject.activePageSource == null || !hasUnsavedPageChanges || isBusy) return;
    const path = activeProject.activePagePath;
    const source = activeProject.activePageSource;
    const revision = editRevisionRef.current;
    const project = await withBusy("save", () => fractalClient.writePage(activeProject, source));
    if (project) {
      const hasNewerEdits = editRevisionRef.current !== revision;
      setActiveProject((currentProject) =>
        hasNewerEdits && currentProject?.rootPath === project.rootPath && currentProject.activePagePath === path
          ? { ...project, activePageSource: currentProject.activePageSource }
          : project
      );
      setHasUnsavedPageChanges(hasNewerEdits);
      if (hasNewerEdits) {
        setCommandResult({ ok: true, message: "Earlier changes saved. Newer edits are still unsaved.", details: path });
      } else {
        clearPageDraft(project.rootPath, path);
        setCommandResult({ ok: true, message: "Page saved.", details: path });
      }
    }
  }, [activeProject, hasUnsavedPageChanges, isBusy, withBusy]);

  const createProjectPage = useCallback(async (title: string) => {
    if (!activeProject || isBusy || !title.trim()) return;
    let discardCurrentDraft = false;
    if (hasUnsavedPageChanges) {
      if (!(await confirm("Discard unsaved changes and create a page?", "Discard changes"))) return;
      discardCurrentDraft = true;
    }
    const project = await withBusy("page", () => fractalClient.createPage(activeProject, title.trim()));
    if (project) {
      if (discardCurrentDraft) discardActiveDraft();
      await acceptLoadedProject(project);
      setCommandResult({ ok: true, message: "Page created.", details: project.activePagePath });
    }
  }, [acceptLoadedProject, activeProject, confirm, discardActiveDraft, hasUnsavedPageChanges, isBusy, withBusy]);

  const createProjectFolder = useCallback(async (folderPath: string) => {
    if (!activeProject || isBusy || !folderPath.trim()) return;
    const project = await withBusy("page", () => fractalClient.createFolder(activeProject, folderPath.trim()));
    if (project) {
      setActiveProject(hasUnsavedPageChanges ? { ...project, activePageSource: activeProject.activePageSource } : project);
      setCommandResult({ ok: true, message: "Folder created.", details: folderPath.trim() });
    }
  }, [activeProject, hasUnsavedPageChanges, isBusy, withBusy]);

  const deleteProjectFolder = useCallback(async (folderPath: string) => {
    if (!activeProject || isBusy) return;
    const pageCount = activeProject.pages.filter((page) => page.path.startsWith(`${folderPath}/`)).length;
    const deletesActivePage = activeProject.activePagePath?.startsWith(`${folderPath}/`) ?? false;
    const pageNote = pageCount ? ` Fractal will delete ${pageCount} page${pageCount === 1 ? "" : "s"} inside it first.` : "";
    const draftNote = deletesActivePage && hasUnsavedPageChanges ? " Unsaved changes will be discarded." : "";
    if (!(await confirm(`Delete ${folderPath}?${pageNote}${draftNote}`, "Delete folder"))) return;
    const project = await withBusy("page", () => fractalClient.deleteFolder(activeProject, folderPath));
    if (project) {
      for (const page of activeProject.pages.filter((item) => item.path.startsWith(`${folderPath}/`))) {
        clearPageDraft(activeProject.rootPath, page.path);
      }
      if (deletesActivePage) {
        await acceptLoadedProject(project);
      } else {
        setActiveProject(hasUnsavedPageChanges ? { ...project, activePageSource: activeProject.activePageSource } : project);
      }
      setCommandResult({ ok: true, message: "Folder deleted.", details: folderPath });
    }
  }, [acceptLoadedProject, activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const moveProjectPage = useCallback(async (pagePath: string, destination: string) => {
    if (!activeProject || isBusy || !destination.trim() || destination.trim() === pagePath) return;
    let discardCurrentDraft = false;
    if (hasUnsavedPageChanges) {
      if (!(await confirm("Discard unsaved changes and move this page?", "Discard changes"))) return;
      discardCurrentDraft = true;
    }
    const project = await withBusy("page", () => fractalClient.movePage(activeProject, pagePath, destination.trim()));
    if (project) {
      if (discardCurrentDraft) discardActiveDraft();
      await acceptLoadedProject(project);
      setCommandResult({ ok: true, message: "Page moved.", details: `${pagePath} → ${destination.trim()}` });
    }
  }, [acceptLoadedProject, activeProject, confirm, discardActiveDraft, hasUnsavedPageChanges, isBusy, withBusy]);

  const deleteProjectPage = useCallback(async (pagePath: string) => {
    if (!activeProject || isBusy) return;
    const suffix = hasUnsavedPageChanges ? " Unsaved changes will be discarded." : "";
    if (!(await confirm(`Delete ${pagePath}?${suffix}`, "Delete page"))) return;
    const project = await withBusy("page", () => fractalClient.deletePage(activeProject, pagePath));
    if (project) {
      clearPageDraft(activeProject.rootPath, pagePath);
      await acceptLoadedProject(project);
      setCommandResult({ ok: true, message: "Page deleted.", details: pagePath });
    }
  }, [acceptLoadedProject, activeProject, confirm, hasUnsavedPageChanges, isBusy, withBusy]);

  const validateProject = useCallback(async () => {
    if (!activeProject) return;
    const result = await withBusy("command", () => fractalClient.validateProject(activeProject));
    if (result) setCommandResult(result);
  }, [activeProject, withBusy]);

  const dismissStatus = useCallback(() => { setCommandResult(null); setError(null); }, []);

  useEffect(() => { void refreshProjectCatalog(); }, [refreshProjectCatalog]);
  useEffect(() => {
    if (!activeProject || !hasUnsavedPageChanges) return;
    const timeout = window.setTimeout(() => writePageDraft(activeProject), 180);
    return () => window.clearTimeout(timeout);
  }, [activeProject, hasUnsavedPageChanges]);

  return {
    activeProject,
    commandResult,
    confirmDialog: confirmState ? { confirmLabel: confirmState.confirmLabel, message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    hasUnsavedPageChanges,
    isBusy,
    saveState: busyOperation === "save" ? "saving" as const : hasUnsavedPageChanges ? "unsaved" as const : "saved" as const,
    projectCatalog,
    createProjectPage,
    createProjectFolder,
    deleteProjectPage,
    deleteProjectFolder,
    dismissStatus,
    discardActiveDraft,
    loadProject,
    moveProjectPage,
    openProjectPage,
    refreshProjectCatalog,
    requestConfirmation: confirm,
    saveActivePage,
    updateActivePageSource,
    validateProject
  };
}
