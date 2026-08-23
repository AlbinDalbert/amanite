import { useCallback, useEffect, useRef, useState } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalProject, FractalProjectCatalog, FractalSearchResult } from "@/lib/fractal/types";
import { clearPageDraft, readPageDraft, writePageDraft } from "./pageDrafts";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sourceWithTitle(source: string, title: string) {
  const document = new DOMParser().parseFromString(source, "text/html");
  const previousTitle = document.title.trim();
  document.title = title;
  const root = document.body.querySelector("main[data-fractal-document]");
  const heading = root?.querySelector("h1");
  if (heading?.textContent?.trim() === previousTitle) heading.textContent = title;
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>\n` : "<!doctype html>\n";
  return `${doctype}${document.documentElement.outerHTML}\n`;
}

type BusyOperation = "catalog" | "load" | "command" | "page" | "save" | null;
type ConfirmState = { confirmLabel: string; message: string; resolve: (confirmed: boolean) => void };
type SessionOptions = { autoSave: boolean };

export function useFractalSession({ autoSave }: SessionOptions) {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedPageChanges, setHasUnsavedPageChanges] = useState(false);
  const [busyOperation, setBusyOperation] = useState<BusyOperation>("catalog");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [externalChangeDetected, setExternalChangeDetected] = useState(false);
  const editRevisionRef = useRef(0);
  const activeProjectRef = useRef(activeProject);
  const unsavedRef = useRef(hasUnsavedPageChanges);
  const busyRef = useRef(busyOperation);
  activeProjectRef.current = activeProject;
  unsavedRef.current = hasUnsavedPageChanges;
  busyRef.current = busyOperation;
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
    const project = activeProjectRef.current;
    if (project?.activePagePath) clearPageDraft(project.rootPath, project.activePagePath);
  }, []);

  const acceptLoadedProject = useCallback(async (project: FractalProject, checkDraft = true) => {
    const pagePath = project.activePagePath;
    const pageSource = project.activePageSource;
    const draft = checkDraft && pagePath && pageSource != null ? readPageDraft(project.rootPath, pagePath) : null;

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
    setExternalChangeDetected(false);
    try {
      localStorage.setItem("amanite.last-session.v1", JSON.stringify({ pagePath, projectRoot: project.rootPath }));
    } catch {
      // Session restore is optional.
    }
  }, [confirm]);

  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", fractalClient.listProjects);
    if (catalog) setProjectCatalog(catalog);
  }, [withBusy]);

  const loadProject = useCallback(async (action: () => Promise<FractalProject>) => {
    const project = await withBusy("load", action);
    if (project) await acceptLoadedProject(project);
  }, [acceptLoadedProject, withBusy]);

  const saveActivePage = useCallback(async () => {
    const projectAtStart = activeProjectRef.current;
    if (!projectAtStart?.activePagePath || projectAtStart.activePageSource == null || !unsavedRef.current || busyRef.current) return !unsavedRef.current;
    const path = projectAtStart.activePagePath;
    const source = projectAtStart.activePageSource;
    const revision = editRevisionRef.current;
    const project = await withBusy("save", () => fractalClient.writePage(projectAtStart, source));
    if (!project) return false;
    const hasNewerEdits = editRevisionRef.current !== revision;
    setActiveProject((currentProject) =>
      hasNewerEdits && currentProject?.rootPath === project.rootPath && currentProject.activePagePath === path
        ? { ...project, activePageSource: currentProject.activePageSource }
        : project
    );
    setHasUnsavedPageChanges(hasNewerEdits);
    setExternalChangeDetected(false);
    if (hasNewerEdits) {
      setCommandResult({ ok: true, message: "Earlier changes saved. Newer edits are still unsaved.", details: path });
    } else {
      clearPageDraft(project.rootPath, path);
      setCommandResult({ ok: true, message: "Page saved.", details: path });
    }
    return true;
  }, [withBusy]);

  const prepareForPageChange = useCallback(async () => !unsavedRef.current || saveActivePage(), [saveActivePage]);

  const openProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || pagePath === current.activePagePath || busyRef.current || !(await prepareForPageChange())) return;
    const project = await withBusy("page", () => fractalClient.openPage(activeProjectRef.current ?? current, pagePath));
    if (project) await acceptLoadedProject(project);
  }, [acceptLoadedProject, prepareForPageChange, withBusy]);

  const updateActivePageSource = useCallback((source: string) => {
    editRevisionRef.current += 1;
    setActiveProject((project) => project ? { ...project, activePageSource: source } : project);
    setCommandResult(null);
    setHasUnsavedPageChanges(true);
  }, []);

  const createProjectPage = useCallback(async (title: string, folderPath?: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !title.trim() || !(await prepareForPageChange())) return;
    const project = await withBusy("page", () => fractalClient.createPage(activeProjectRef.current ?? current, title.trim(), folderPath));
    if (project) {
      await acceptLoadedProject(project);
      setCommandResult({ ok: true, message: "Page created.", details: project.activePagePath });
    }
  }, [acceptLoadedProject, prepareForPageChange, withBusy]);

  const duplicateProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !(await prepareForPageChange())) return;
    const sourceProject = current.activePagePath === pagePath
      ? activeProjectRef.current ?? current
      : await withBusy("page", () => fractalClient.openPage(activeProjectRef.current ?? current, pagePath));
    if (!sourceProject?.activePageSource) return;
    const page = sourceProject.pages.find((candidate) => candidate.path === pagePath);
    if (!page || page.kind !== "native") {
      setError("Fractal can only create native pages, so raw HTML cannot be duplicated safely yet.");
      return;
    }
    const base = `${page.title?.trim() || "Untitled"} copy`;
    const existingTitles = new Set(sourceProject.pages.map((candidate) => candidate.title?.toLowerCase()));
    let title = base;
    let copyNumber = 2;
    while (existingTitles.has(title.toLowerCase())) title = `${base} ${copyNumber++}`;
    const folderPath = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : undefined;
    const created = await withBusy("page", () => fractalClient.createPage(sourceProject, title, folderPath));
    if (!created || !created.activePagePath) return;
    const written = await withBusy("save", () => fractalClient.writePage(created, sourceWithTitle(sourceProject.activePageSource!, title)));
    if (written) {
      await acceptLoadedProject(written, false);
      setCommandResult({ ok: true, message: "Page duplicated.", details: written.activePagePath });
    }
  }, [acceptLoadedProject, prepareForPageChange, withBusy]);

  const importNativePage = useCallback(async (source: string, folderPath?: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !(await prepareForPageChange())) return;
    const document = new DOMParser().parseFromString(source, "text/html");
    const title = document.title.trim();
    if (!title) { setError("The imported Fractal document needs a <title>."); return; }
    const project = await withBusy("page", () => fractalClient.importNativePage(activeProjectRef.current ?? current, title, source, folderPath));
    if (project) {
      await acceptLoadedProject(project, false);
      setCommandResult({ ok: true, message: "Fractal document imported.", details: project.activePagePath });
    }
  }, [acceptLoadedProject, prepareForPageChange, withBusy]);

  const createProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !folderPath.trim()) return;
    const project = await withBusy("page", () => fractalClient.createFolder(current, folderPath.trim()));
    if (project) {
      setActiveProject(unsavedRef.current ? { ...project, activePageSource: current.activePageSource } : project);
      setCommandResult({ ok: true, message: "Folder created.", details: folderPath.trim() });
    }
  }, [withBusy]);

  const deleteProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return;
    const pageCount = current.pages.filter((page) => page.path.startsWith(`${folderPath}/`)).length;
    if (!(await confirm(`Delete ${folderPath}? Fractal will remove ${pageCount} page${pageCount === 1 ? "" : "s"} inside it.`, "Delete folder"))) return;
    if (!(await prepareForPageChange())) return;
    const project = await withBusy("page", () => fractalClient.deleteFolder(activeProjectRef.current ?? current, folderPath));
    if (project) {
      for (const page of current.pages.filter((item) => item.path.startsWith(`${folderPath}/`))) clearPageDraft(current.rootPath, page.path);
      await acceptLoadedProject(project, false);
      setCommandResult({ ok: true, message: "Folder deleted.", details: folderPath });
    }
  }, [acceptLoadedProject, confirm, prepareForPageChange, withBusy]);

  const moveProjectPage = useCallback(async (pagePath: string, destination: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !destination.trim() || destination.trim() === pagePath || !(await prepareForPageChange())) return;
    const project = await withBusy("page", () => fractalClient.movePage(activeProjectRef.current ?? current, pagePath, destination.trim()));
    if (project) {
      clearPageDraft(current.rootPath, pagePath);
      await acceptLoadedProject(project, false);
      setCommandResult({ ok: true, message: "Page moved.", details: `${pagePath} to ${destination.trim()}` });
    }
  }, [acceptLoadedProject, prepareForPageChange, withBusy]);

  const deleteProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !(await confirm(`Delete ${pagePath}?`, "Delete page"))) return;
    if (!(await prepareForPageChange())) return;
    const project = await withBusy("page", () => fractalClient.deletePage(activeProjectRef.current ?? current, pagePath));
    if (project) {
      clearPageDraft(current.rootPath, pagePath);
      await acceptLoadedProject(project, false);
      setCommandResult({ ok: true, message: "Page deleted.", details: pagePath });
    }
  }, [acceptLoadedProject, confirm, prepareForPageChange, withBusy]);

  const searchProject = useCallback(async (query: string): Promise<FractalSearchResult[]> => {
    const current = activeProjectRef.current;
    if (!current || !query.trim()) return [];
    try { return await fractalClient.searchProject(current, query.trim()); }
    catch (caughtError) { setError(getErrorMessage(caughtError)); return []; }
  }, []);

  const reloadActivePage = useCallback(async () => {
    const current = activeProjectRef.current;
    if (!current?.activePagePath || busyRef.current) return;
    const project = await withBusy("page", () => fractalClient.openPage(current, current.activePagePath!));
    if (project) {
      discardActiveDraft();
      await acceptLoadedProject(project, false);
      setCommandResult({ ok: true, message: "Page reloaded from disk.", details: project.activePagePath });
    }
  }, [acceptLoadedProject, discardActiveDraft, withBusy]);

  const revealPage = useCallback(async (pagePath?: string) => {
    const current = activeProjectRef.current;
    if (!current) return;
    try { await fractalClient.revealPage(current, pagePath); }
    catch (caughtError) { setError(getErrorMessage(caughtError)); }
  }, []);

  const closeProject = useCallback(async () => {
    if (!(await prepareForPageChange())) return;
    setActiveProject(null);
    setCommandResult(null);
    setError(null);
    setHasUnsavedPageChanges(false);
    await refreshProjectCatalog();
  }, [prepareForPageChange, refreshProjectCatalog]);

  const validateProject = useCallback(async () => {
    const current = activeProjectRef.current;
    if (!current) return;
    const result = await withBusy("command", () => fractalClient.validateProject(current));
    if (result) setCommandResult(result);
  }, [withBusy]);

  const dismissStatus = useCallback(() => { setCommandResult(null); setError(null); }, []);

  useEffect(() => { void refreshProjectCatalog(); }, [refreshProjectCatalog]);
  useEffect(() => {
    if (!activeProject || !hasUnsavedPageChanges) return;
    const timeout = window.setTimeout(() => writePageDraft(activeProject), 180);
    return () => window.clearTimeout(timeout);
  }, [activeProject, hasUnsavedPageChanges]);
  useEffect(() => {
    if (!autoSave || !activeProject || !hasUnsavedPageChanges || isBusy) return;
    const timeout = window.setTimeout(() => { void saveActivePage(); }, 900);
    return () => window.clearTimeout(timeout);
  }, [activeProject, autoSave, hasUnsavedPageChanges, isBusy, saveActivePage]);
  useEffect(() => {
    if (!activeProject?.activePagePath) return;
    const interval = window.setInterval(async () => {
      const current = activeProjectRef.current;
      if (!current?.activePagePath || busyRef.current || externalChangeDetected) return;
      try {
        const modified = await fractalClient.pageModifiedMs(current);
        if (modified != null && current.activePageModifiedMs != null && modified !== current.activePageModifiedMs) {
          setExternalChangeDetected(true);
          setCommandResult({ ok: false, message: "This page changed on disk.", details: "Reload it before continuing, or save to replace the external version." });
        }
      } catch {
        // A transient metadata check must not interrupt writing.
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [activeProject?.activePagePath, externalChangeDetected]);

  return {
    activeProject,
    commandResult,
    confirmDialog: confirmState ? { confirmLabel: confirmState.confirmLabel, message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    externalChangeDetected,
    hasUnsavedPageChanges,
    isBusy,
    saveState: busyOperation === "save" ? "saving" as const : hasUnsavedPageChanges ? "unsaved" as const : "saved" as const,
    projectCatalog,
    createProjectPage,
    createProjectFolder,
    deleteProjectPage,
    deleteProjectFolder,
    closeProject,
    dismissStatus,
    discardActiveDraft,
    duplicateProjectPage,
    importNativePage,
    loadProject,
    moveProjectPage,
    openProjectPage,
    refreshProjectCatalog,
    reloadActivePage,
    requestConfirmation: confirm,
    revealPage,
    saveActivePage,
    searchProject,
    updateActivePageSource,
    validateProject
  };
}
