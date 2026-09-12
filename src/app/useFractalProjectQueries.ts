import { useCallback, useEffect } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalProject, FractalProjectCatalog, FractalProjectInspection, FractalSearchResult } from "@/lib/fractal/types";

type MutableValue<T> = { current: T };
type WithBusy = <T>(operation: "catalog" | "command", action: () => Promise<T>) => Promise<T | null>;

type Options = {
  activeProjectRef: MutableValue<FractalProject | null>;
  setCommandResult: (result: FractalCommandResult | null) => void;
  setError: (message: string | null) => void;
  setInspection: (inspection: FractalProjectInspection | null) => void;
  setProjectCatalog: (catalog: FractalProjectCatalog | null) => void;
  withBusy: WithBusy;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useFractalProjectQueries({ activeProjectRef, setCommandResult, setError, setInspection, setProjectCatalog, withBusy }: Options) {
  const refreshProjectCatalog = useCallback(async () => {
    const catalog = await withBusy("catalog", fractalClient.listProjects);
    if (catalog) setProjectCatalog(catalog);
  }, [setProjectCatalog, withBusy]);

  const inspectProject = useCallback(async (projectRoot?: string) => {
    const root = projectRoot ?? activeProjectRef.current?.rootPath;
    if (!root) return null;
    const checked = await withBusy("command", () => fractalClient.inspectProject(root));
    if (checked) setInspection(checked);
    return checked;
  }, [activeProjectRef, setInspection, withBusy]);

  const searchProject = useCallback(async (query: string): Promise<FractalSearchResult[]> => {
    const current = activeProjectRef.current;
    if (!current || !query.trim()) return [];
    try {
      return await fractalClient.searchProject(current, query.trim());
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
      return [];
    }
  }, [activeProjectRef, setError]);

  const revealPage = useCallback(async (pagePath?: string) => {
    const current = activeProjectRef.current;
    if (!current) return;
    try {
      await fractalClient.revealPage(current, pagePath);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }, [activeProjectRef, setError]);

  const validateProject = useCallback(async () => {
    const current = activeProjectRef.current;
    if (!current) return;
    const result = await withBusy("command", () => fractalClient.validateProject(current));
    if (result) setCommandResult(result);
  }, [activeProjectRef, setCommandResult, withBusy]);

  useEffect(() => {
    void refreshProjectCatalog();
  }, [refreshProjectCatalog]);

  return { inspectProject, refreshProjectCatalog, revealPage, searchProject, validateProject };
}
