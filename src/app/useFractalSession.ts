import { useCallback, useEffect, useRef, useState } from "react";
import { fractalClient, isFractalCommandError } from "@/lib/fractal/client";
import type { FractalCommandError, FractalCommandResult, FractalProject, FractalProjectCatalog, FractalSearchResult } from "@/lib/fractal/types";
import { clearPageDraft } from "./pageDrafts";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type FractalFailureStatus = "conflict" | "recovery_required" | "inspection_required" | "committed" | "unsupported_version" | "operation_error";

export function describeFractalFailure(error: FractalCommandError): { message: string; refresh: boolean; status: FractalFailureStatus } {
  switch (error.code) {
    case "conflict": return { message: `This page changed on disk. ${error.message}`, refresh: false, status: "conflict" };
    case "recovery_required": return { message: `Project recovery is required before more changes can be made. ${error.message}`, refresh: false, status: "recovery_required" };
    case "indeterminate": return { message: `The project state is uncertain and needs inspection. ${error.message}`, refresh: true, status: "inspection_required" };
    case "mutation_committed": return { message: `The files changed, but Fractal could not reload the project. ${error.message}`, refresh: true, status: "committed" };
    case "unsupported_version": return { message: `This project uses an unsupported Fractal version. Amanite cannot migrate it. ${error.message}`, refresh: false, status: "unsupported_version" };
    default: return { message: error.message, refresh: false, status: "operation_error" };
  }
}

type BusyOperation = "catalog" | "load" | "command" | "page" | "save" | null;
type ConfirmState = { confirmLabel: string; message: string; resolve: (confirmed: boolean) => void };

export function useFractalSession() {
  const [activeProject, setActiveProject] = useState<FractalProject | null>(null);
  const [projectCatalog, setProjectCatalog] = useState<FractalProjectCatalog | null>(null);
  const [commandResult, setCommandResult] = useState<FractalCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failureStatus, setFailureStatus] = useState<FractalFailureStatus | null>(null);
  const [busyOperation, setBusyOperation] = useState<BusyOperation>("catalog");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const activeProjectRef = useRef(activeProject);
  const busyRef = useRef(busyOperation);
  activeProjectRef.current = activeProject;
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
    setFailureStatus(null);
    try {
      return await action();
    } catch (caughtError) {
      if (isFractalCommandError(caughtError)) {
        const failure = describeFractalFailure(caughtError);
        setFailureStatus(failure.status);
        setError(failure.message);
        if (failure.refresh && activeProjectRef.current) {
          try {
            const refreshed = await fractalClient.openProjectPath(activeProjectRef.current.rootPath);
            activeProjectRef.current = refreshed;
            setActiveProject(refreshed);
          } catch {
            // The operation error remains the useful status when refresh also fails.
          }
        }
      } else {
        setFailureStatus("operation_error");
        setError(getErrorMessage(caughtError));
      }
      return null;
    } finally {
      setBusyOperation(null);
    }
  }, []);

  const acceptProject = useCallback((project: FractalProject) => {
    activeProjectRef.current = project;
    setActiveProject(project);
    setCommandResult(null);
    try {
      localStorage.setItem("amanite.last-session.v1", JSON.stringify({
        projectRoot: project.rootPath
      }));
    } catch {
      // Session restore is optional.
    }
  }, []);

  const adoptProjectSnapshot = useCallback((project: FractalProject) => {
    activeProjectRef.current = project;
    setActiveProject(project);
  }, []);

  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", fractalClient.listProjects);
    if (catalog) setProjectCatalog(catalog);
  }, [withBusy]);

  const loadProject = useCallback(async (action: () => Promise<FractalProject>) => {
    const project = await withBusy("load", action);
    if (project) acceptProject(project);
  }, [acceptProject, withBusy]);

  const createProjectPage = useCallback(async (title: string, folderPath?: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !title.trim()) return null;
    const result = await withBusy("page", () => fractalClient.createPage(current, title.trim(), folderPath));
    const project = result?.project;
    if (project) {
      acceptProject(project);
      setCommandResult({ ok: true, message: "Page created.", details: project.activePagePath });
    }
    return project;
  }, [acceptProject, withBusy]);

  const duplicateProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const sourceProject = current.activePagePath === pagePath
      ? current
      : await withBusy("page", () => fractalClient.openPage(current, pagePath));
    if (!sourceProject?.activePageSource) return null;
    const page = sourceProject.pages.find((candidate) => candidate.path === pagePath);
    if (!page) return null;
    const sections = sourceProject.activePageNativeDocumentParts;
    if (!sections) {
      setError("This native page is missing the sections required for duplication.");
      return null;
    }
    const base = `${page.title?.trim() || "Untitled"} copy`;
    const existingTitles = new Set(sourceProject.pages.map((candidate) => candidate.title?.toLowerCase()));
    let title = base;
    let copyNumber = 2;
    while (existingTitles.has(title.toLowerCase())) title = `${base} ${copyNumber++}`;
    const folderPath = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : undefined;
    const result = await withBusy("page", () => fractalClient.duplicatePage(current, pagePath, title, folderPath));
    const written = result?.project;
    if (written) {
      acceptProject(written);
      if (result.failure) {
        const failure = describeFractalFailure(result.failure);
        setFailureStatus(failure.status);
        setError(`The duplicate was created but is incomplete. ${failure.message}`);
      } else {
        setCommandResult({ ok: true, message: "Page duplicated.", details: written.activePagePath });
      }
    }
    return written;
  }, [acceptProject, withBusy]);

  const repairProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const result = await withBusy("page", () => fractalClient.repairPageStructure(current, pagePath));
    const project = result?.project;
    if (project) {
      acceptProject(project);
      setCommandResult({ ok: true, message: "Native document repaired.", details: pagePath });
    }
    return project;
  }, [acceptProject, withBusy]);

  const createProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !folderPath.trim()) return null;
    const segments = folderPath.trim().split("/").filter(Boolean);
    const title = segments.pop();
    if (!title) return null;
    const parent = segments.join("/");
    const result = await withBusy("page", () => fractalClient.createFolder(current, parent, title));
    const project = result?.project;
    if (project) {
      acceptProject(project);
      setCommandResult({ ok: true, message: "Folder created.", details: folderPath.trim() });
    }
    return project;
  }, [acceptProject, withBusy]);

  const setProjectFolderTitle = useCallback(async (folderPath: string, title: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !title.trim()) return null;
    const result = await withBusy("page", () => fractalClient.setFolderTitle(current, folderPath, title.trim()));
    const project = result?.project;
    if (project) {
      acceptProject(project);
      setCommandResult({ ok: true, message: "Folder title changed.", details: title.trim() });
    }
    return project;
  }, [acceptProject, withBusy]);

  const reorderProjectFolder = useCallback(async (folderPath: string, order: string[]) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const result = await withBusy("page", () => fractalClient.reorderFolder(current, folderPath, order));
    const project = result?.project;
    if (project) {
      acceptProject(project);
      setCommandResult({ ok: true, message: "Folder reordered.", details: project.folders.find((folder) => folder.path === folderPath)?.title });
    }
    return project;
  }, [acceptProject, withBusy]);

  const deleteProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const pageCount = current.pages.filter((page) => page.path.startsWith(`${folderPath}/`)).length;
    if (!(await confirm(`Delete ${folderPath}? Fractal will remove ${pageCount} page${pageCount === 1 ? "" : "s"} inside it.`, "Delete folder"))) return null;
    const result = await withBusy("page", () => fractalClient.deleteFolder(current, folderPath));
    const project = result?.project;
    if (project) {
      for (const page of current.pages.filter((item) => item.path.startsWith(`${folderPath}/`))) clearPageDraft(current.rootPath, page.path);
      acceptProject(project);
      setCommandResult({ ok: true, message: "Folder deleted.", details: folderPath });
    }
    return project;
  }, [acceptProject, confirm, withBusy]);

  const moveProjectPage = useCallback(async (pagePath: string, destinationFolder: string) => {
    const current = activeProjectRef.current;
    const folder = destinationFolder.trim().replace(/^\/+|\/+$/g, "");
    const currentFolder = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : "";
    if (!current || busyRef.current || folder === currentFolder) return null;
    const result = await withBusy("page", () => fractalClient.movePage(current, pagePath, folder));
    const project = result?.project;
    if (project) {
      clearPageDraft(current.rootPath, pagePath);
      acceptProject(project);
      setCommandResult({ ok: true, message: "Page moved.", details: project.activePagePath });
    }
    return project;
  }, [acceptProject, withBusy]);

  const deleteProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !(await confirm(`Delete ${pagePath}?`, "Delete page"))) return null;
    const result = await withBusy("page", () => fractalClient.deletePage(current, pagePath));
    const project = result?.project;
    if (project) {
      clearPageDraft(current.rootPath, pagePath);
      acceptProject(project);
      setCommandResult({ ok: true, message: "Page deleted.", details: pagePath });
    }
    return project;
  }, [acceptProject, confirm, withBusy]);

  const searchProject = useCallback(async (query: string): Promise<FractalSearchResult[]> => {
    const current = activeProjectRef.current;
    if (!current || !query.trim()) return [];
    try {
      return await fractalClient.searchProject(current, query.trim());
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      return [];
    }
  }, []);

  const revealPage = useCallback(async (pagePath?: string) => {
    const current = activeProjectRef.current;
    if (!current) return;
    try {
      await fractalClient.revealPage(current, pagePath);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }, []);

  const closeProject = useCallback(async () => {
    activeProjectRef.current = null;
    setActiveProject(null);
    setCommandResult(null);
    setError(null);
    setFailureStatus(null);
    await refreshProjectCatalog();
  }, [refreshProjectCatalog]);

  const validateProject = useCallback(async () => {
    const current = activeProjectRef.current;
    if (!current) return;
    const result = await withBusy("command", () => fractalClient.validateProject(current));
    if (result) setCommandResult(result);
  }, [withBusy]);

  const dismissStatus = useCallback(() => {
    setCommandResult(null);
    setError(null);
    setFailureStatus(null);
  }, []);

  useEffect(() => {
    void refreshProjectCatalog();
  }, [refreshProjectCatalog]);

  return {
    activeProject,
    adoptProjectSnapshot,
    commandResult,
    confirmDialog: confirmState ? { confirmLabel: confirmState.confirmLabel, message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    failureStatus,
    isBusy,
    projectCatalog,
    createProjectPage,
    createProjectFolder,
    setProjectFolderTitle,
    reorderProjectFolder,
    deleteProjectPage,
    deleteProjectFolder,
    closeProject,
    dismissStatus,
    duplicateProjectPage,
    repairProjectPage,
    loadProject,
    moveProjectPage,
    refreshProjectCatalog,
    requestConfirmation: confirm,
    revealPage,
    searchProject,
    validateProject
  };
}
