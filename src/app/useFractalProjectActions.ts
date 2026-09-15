import { useCallback } from "react";
import { clearPageDraft } from "./pageDrafts";
import { describeFractalFailure, type FractalFailureStatus } from "./fractalFailure";
import { fractalClient } from "@/lib/fractal/client";
import { reconcileMutationBatch } from "@/lib/fractal/reconcile";
import type { FractalCommandResult, FractalMutationBatchResult, FractalMutationReceipt, FractalMutationResult, FractalProject } from "@/lib/fractal/types";

type MutableValue<T> = { current: T };
type WithBusy = <T>(operation: "page", action: () => Promise<T>) => Promise<T | null>;

type Options = {
  acceptProject: (project: FractalProject, newSession?: boolean) => void;
  acceptMutation: (result: FractalMutationResult) => FractalMutationResult;
  activeProjectRef: MutableValue<FractalProject | null>;
  busyRef: MutableValue<"catalog" | "load" | "command" | "page" | "save" | null>;
  confirm: (message: string, confirmLabel?: string) => Promise<boolean>;
  setError: (message: string | null) => void;
  setCommandResult: (result: FractalCommandResult | null) => void;
  setFailureStatus: (status: FractalFailureStatus | null) => void;
  setLastReceipt: (receipt: FractalMutationReceipt | null) => void;
  withBusy: WithBusy;
};

function duplicatePageTitle(pageTitle: string | null | undefined, pages: FractalProject["pages"]) {
  const base = `${pageTitle?.trim() || "Untitled"} copy`;
  const existingTitles = new Set(pages.map((page) => page.title?.toLowerCase()));
  let title = base;
  let copyNumber = 2;
  while (existingTitles.has(title.toLowerCase())) title = `${base} ${copyNumber++}`;
  return title;
}

function cleanupErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function clearDeletedDrafts(
  projectRoot: string,
  pagePaths: string[],
  deletionLabel: string,
  setCommandResult: (result: FractalCommandResult | null) => void
) {
  const failures: string[] = [];
  for (const pagePath of pagePaths) {
    try {
      await clearPageDraft(projectRoot, pagePath);
    } catch (error) {
      failures.push(`${pagePath}: ${cleanupErrorMessage(error)}`);
    }
  }
  if (failures.length) {
    setCommandResult({
      ok: false,
      message: `${deletionLabel} Draft cleanup failed for ${failures.length} page${failures.length === 1 ? "" : "s"}.`,
      details: failures.join("; ")
    });
  }
}

function reportDuplicateResult(result: FractalMutationBatchResult, setCommandResult: (result: FractalCommandResult | null) => void, setError: (message: string | null) => void, setFailureStatus: (status: FractalFailureStatus | null) => void, setLastReceipt: (receipt: FractalMutationReceipt | null) => void) {
  let hasWarning = false;
  for (const receipt of result.receipts) {
    setLastReceipt(receipt);
    const warning = receipt.warnings[0];
    if (warning) {
      hasWarning = true;
      setCommandResult({ ok: false, message: warning.message, details: warning.code });
    }
  }
  if (!result.failure) {
    if (!hasWarning) setCommandResult({ ok: true, message: "Page duplicated.", details: result.project.activePagePath });
    return;
  }
  const failure = describeFractalFailure(result.failure);
  setFailureStatus(failure.status);
  setError(`The duplicate was created but is incomplete. ${failure.message}`);
}

export function useFractalProjectActions({ acceptProject, acceptMutation, activeProjectRef, busyRef, confirm, setError, setCommandResult, setFailureStatus, setLastReceipt, withBusy }: Options) {
  const runMutation = useCallback(async (action: () => Promise<FractalMutationResult>, success: (project: FractalProject) => FractalCommandResult) => {
    const result = await withBusy("page", action);
    if (!result) return null;
    const accepted = acceptMutation(result);
    if (!accepted.receipt.warnings.length) setCommandResult(success(accepted.project));
    return accepted;
  }, [acceptMutation, setCommandResult, withBusy]);

  const createProjectPage = useCallback(async (title: string, folderPath?: string) => {
    const current = activeProjectRef.current;
    const trimmedTitle = title.trim();
    if (!current || busyRef.current || !trimmedTitle) return null;
    return runMutation(
      () => fractalClient.createPage(current, trimmedTitle, folderPath),
      (project) => ({ ok: true, message: "Page created.", details: project.activePagePath })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const repairProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    return runMutation(
      () => fractalClient.repairPageStructure(current, pagePath),
      () => ({ ok: true, message: "Native document repaired.", details: pagePath })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const duplicateProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const loaded = await withBusy("page", () => fractalClient.readPage(current, pagePath));
    if (!loaded) return null;
    const page = current.pages.find((candidate) => candidate.path === pagePath);
    if (!page) return null;
    if (!loaded.nativeDocumentParts) {
      setError("This native page is missing the sections required for duplication.");
      return null;
    }
    const title = duplicatePageTitle(page.title, current.pages);
    const folderPath = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : undefined;
    const result = await withBusy("page", () => fractalClient.duplicatePage(current, pagePath, title, folderPath));
    if (!result) return null;
    const accepted = reconcileMutationBatch(activeProjectRef.current ?? current, result).result;
    acceptProject(accepted.project);
    reportDuplicateResult(accepted, setCommandResult, setError, setFailureStatus, setLastReceipt);
    return accepted;
  }, [acceptProject, activeProjectRef, busyRef, setCommandResult, setError, setFailureStatus, setLastReceipt, withBusy]);

  const createProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    const segments = folderPath.trim().split("/").filter(Boolean);
    const title = segments.pop();
    if (!current || busyRef.current || !title) return null;
    const parent = segments.join("/");
    return runMutation(
      () => fractalClient.createFolder(current, parent, title),
      () => ({ ok: true, message: "Folder created.", details: folderPath.trim() })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const setProjectFolderTitle = useCallback(async (folderPath: string, title: string) => {
    const current = activeProjectRef.current;
    const trimmedTitle = title.trim();
    if (!current || busyRef.current || !trimmedTitle) return null;
    return runMutation(
      () => fractalClient.setFolderTitle(current, folderPath, trimmedTitle),
      () => ({ ok: true, message: "Folder title changed.", details: trimmedTitle })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const reorderProjectFolder = useCallback(async (folderPath: string, order: string[]) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    return runMutation(
      () => fractalClient.reorderFolder(current, folderPath, order),
      (project) => ({ ok: true, message: "Folder reordered.", details: project.folders.find((folder) => folder.path === folderPath)?.title })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const deleteProjectFolder = useCallback(async (folderPath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current) return null;
    const pagePaths = current.pages
      .filter((page) => page.path.startsWith(`${folderPath}/`))
      .map((page) => page.path);
    if (!(await confirm(`Delete ${folderPath}? Fractal will remove ${pagePaths.length} page${pagePaths.length === 1 ? "" : "s"} inside it.`, "Delete folder"))) return null;
    const result = await runMutation(
      () => fractalClient.deleteFolder(current, folderPath),
      () => ({ ok: true, message: "Folder deleted.", details: folderPath })
    );
    if (result) await clearDeletedDrafts(current.rootPath, pagePaths, "Folder deleted.", setCommandResult);
    return result;
  }, [activeProjectRef, busyRef, confirm, runMutation, setCommandResult]);

  const moveProjectPage = useCallback(async (pagePath: string, destinationFolder: string) => {
    const current = activeProjectRef.current;
    const folder = destinationFolder.trim().replace(/^\/+|\/+$/g, "");
    const currentFolder = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : "";
    if (!current || busyRef.current || folder === currentFolder) return null;
    return runMutation(
      () => fractalClient.movePage(current, pagePath, folder),
      (project) => ({ ok: true, message: "Page moved.", details: project.activePagePath })
    );
  }, [activeProjectRef, busyRef, runMutation]);

  const deleteProjectPage = useCallback(async (pagePath: string) => {
    const current = activeProjectRef.current;
    if (!current || busyRef.current || !(await confirm(`Delete ${pagePath}?`, "Delete page"))) return null;
    const result = await runMutation(
      () => fractalClient.deletePage(current, pagePath),
      () => ({ ok: true, message: "Page deleted.", details: pagePath })
    );
    if (result) await clearDeletedDrafts(current.rootPath, [pagePath], "Page deleted.", setCommandResult);
    return result;
  }, [activeProjectRef, busyRef, confirm, runMutation, setCommandResult]);

  return {
    createProjectFolder,
    createProjectPage,
    deleteProjectFolder,
    deleteProjectPage,
    duplicateProjectPage,
    moveProjectPage,
    repairProjectPage,
    reorderProjectFolder,
    setProjectFolderTitle
  };
}
