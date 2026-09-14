import { useCallback, useRef, useState } from "react";
import { fractalClient, isFractalCommandError } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalMutationReceipt, FractalProject, FractalProjectCatalog, FractalProjectInspection } from "@/lib/fractal/types";
import { describeFractalFailure, type FractalFailureStatus } from "./fractalFailure";
import { listPageDrafts } from "./pageDrafts";
import { useFractalProjectActions } from "./useFractalProjectActions";
import { useFractalProjectQueries } from "./useFractalProjectQueries";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { describeFractalFailure } from "./fractalFailure";

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
  const [inspection, setInspection] = useState<FractalProjectInspection | null>(null);
  const [lastReceipt, setLastReceipt] = useState<FractalMutationReceipt | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [projectGeneration, setProjectGeneration] = useState(0);
  const activeProjectRef = useRef(activeProject);
  const projectGenerationRef = useRef(projectGeneration);
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

  const acceptProject = useCallback((project: FractalProject, newSession = false) => {
    const generation = newSession
      ? projectGenerationRef.current + 1
      : (project.sessionGeneration ?? projectGenerationRef.current) || 1;
    const taggedProject = { ...project, sessionGeneration: generation };
    projectGenerationRef.current = generation;
    activeProjectRef.current = taggedProject;
    setProjectGeneration(generation);
    setActiveProject(taggedProject);
    setCommandResult(null);
    void fractalClient.inspectProject(taggedProject.rootPath).then(setInspection).catch(() => setInspection(null));
    void listPageDrafts(taggedProject.rootPath).then((drafts) => setDraftCount(drafts.length)).catch(() => setDraftCount(0));
    try {
      localStorage.setItem("amanite.last-session.v1", JSON.stringify({
        projectRoot: taggedProject.rootPath
      }));
    } catch {
      // Session restore is optional.
    }
  }, []);

  const acceptMutation = useCallback((result: { project: FractalProject; receipt: FractalMutationReceipt }) => {
    setLastReceipt(result.receipt);
    acceptProject(result.project);
    const warning = result.receipt.warnings[0];
    if (warning) setCommandResult({ ok: false, message: warning.message, details: warning.code });
  }, [acceptProject]);

  const adoptProjectSnapshot = useCallback((project: FractalProject) => {
    const taggedProject = { ...project, sessionGeneration: projectGenerationRef.current || project.sessionGeneration || 1 };
    activeProjectRef.current = taggedProject;
    setActiveProject(taggedProject);
  }, []);

  const { inspectProject, refreshProjectCatalog, revealPage, searchProject, validateProject } = useFractalProjectQueries({
    activeProjectRef,
    setCommandResult,
    setError,
    setInspection,
    setProjectCatalog,
    withBusy
  });

  const loadProject = useCallback(async (action: () => Promise<FractalProject>, projectRoot?: string) => {
    if (projectRoot) {
      const checked = await withBusy("load", () => fractalClient.inspectProject(projectRoot));
      if (!checked) return;
      setInspection(checked);
      if (!checked.openable) {
        setFailureStatus(checked.issues.some((issue) => issue.code === "recovery_required") ? "recovery_required" : "operation_error");
        setError(checked.issues.map((issue) => issue.message).join(" ") || "Fractal cannot open this project.");
        return;
      }
    }
    const project = await withBusy("load", action);
    if (project) acceptProject(project, true);
  }, [acceptProject, withBusy]);

  const recoverProject = useCallback(async (projectRoot: string) => {
    if (!(await confirm("Recover interrupted Fractal transactions? Fractal will roll back pending writes and clean committed transaction data.", "Recover project"))) return null;
    const result = await withBusy("command", () => fractalClient.recoverProject(projectRoot));
    if (result) {
      setInspection(result.inspection);
      if (result.project) acceptProject(result.project, !activeProjectRef.current);
      setCommandResult({ ok: result.report.failures.length === 0, message: `Recovered ${result.report.recoveredTransactions.length} transaction(s) and cleaned ${result.report.cleanedTransactions.length}.` });
      await refreshProjectCatalog();
    }
    return result;
  }, [acceptProject, confirm, refreshProjectCatalog, withBusy]);

  const repairProject = useCallback(async () => {
    const current = activeProjectRef.current;
    if (!current || !inspection?.proposedRepairs.length) return null;
    const proposed = inspection.proposedRepairs.map((repair) => repair.repair === "move_path" ? `${repair.from} -> ${repair.to}` : `Update ${repair.metadata}`).join("\n");
    if (!(await confirm(`Apply these Fractal repairs?\n${proposed}`, "Repair project"))) return null;
    const result = await withBusy("command", () => fractalClient.repairProject(current.rootPath));
    if (result) {
      acceptProject(result.project);
      setInspection(result.inspection);
      setCommandResult({ ok: result.report.failures.length === 0, message: `Project repair changed ${result.report.changes.length} project entries.` });
    }
    return result;
  }, [acceptProject, confirm, inspection, withBusy]);

  const closeProject = useCallback(async () => {
    activeProjectRef.current = null;
    setActiveProject(null);
    setCommandResult(null);
    setError(null);
    setFailureStatus(null);
    await refreshProjectCatalog();
  }, [refreshProjectCatalog]);

  const dismissStatus = useCallback(() => {
    setCommandResult(null);
    setError(null);
    setFailureStatus(null);
  }, []);

  const projectActions = useFractalProjectActions({
    acceptProject,
    acceptMutation,
    activeProjectRef,
    busyRef,
    confirm,
    setError,
    setCommandResult,
    setFailureStatus,
    setLastReceipt,
    withBusy
  });

  return {
    activeProject,
    adoptProjectSnapshot,
    commandResult,
    confirmDialog: confirmState ? { confirmLabel: confirmState.confirmLabel, message: confirmState.message, onAnswer: answerConfirm } : null,
    error,
    failureStatus,
    inspection,
    lastReceipt,
    draftCount,
    isBusy,
    projectCatalog,
    projectGeneration,
    ...projectActions,
    closeProject,
    dismissStatus,
    loadProject,
    inspectProject,
    recoverProject,
    repairProject,
    refreshProjectCatalog,
    requestConfirmation: confirm,
    revealPage,
    searchProject,
    validateProject
  };
}
