import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { clearPageDraft } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalLoadedPage, FractalProject } from "@/lib/fractal/types";
import { bufferFromLoadedPage, bufferFromProject, errorMessage, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { resolveDocumentDraft } from "./documentDraftRecovery";

type MutableValue<T> = { current: T };

type Options = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  initialProject: FractalProject;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
  setLoadErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setLoadingPaths: Dispatch<SetStateAction<Set<string>>>;
};

export function useDocumentLoading({ buffersRef, commitBuffers, initialProject, onRequestConfirmation, projectRef, publishProject, setLoadErrors, setLoadingPaths }: Options) {
  const checkedDraftsRef = useRef(new Set<string>());
  const loadingPromisesRef = useRef(new Map<string, Promise<boolean>>());

  const installLoadedProject = useCallback(async (loaded: FractalProject, checkDraft: boolean) => {
    const path = loaded.activePagePath;
    if (!path || loaded.activePageSource == null) return false;
    const resolved = await resolveDocumentDraft({
      checkDraft,
      onRequestConfirmation,
      pagePath: path,
      projectRoot: loaded.rootPath,
      source: loaded.activePageSource,
      sourceHash: loaded.activePageContentHash
    });
    const buffer = bufferFromProject(loaded, resolved.source, resolved.dirty);
    if (!buffer) return false;
    commitBuffers((current) => ({ ...current, [path]: buffer }));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    publishProject(loaded);
    return true;
  }, [commitBuffers, onRequestConfirmation, publishProject, setLoadErrors]);

  const installLoadedPage = useCallback(async (loaded: FractalLoadedPage, checkDraft: boolean) => {
    const path = loaded.path;
    const rootPath = projectRef.current.rootPath;
    const resolved = await resolveDocumentDraft({
      checkDraft,
      onRequestConfirmation,
      pagePath: path,
      projectRoot: rootPath,
      source: loaded.source,
      sourceHash: loaded.contentHash
    });
    const buffer = bufferFromLoadedPage(loaded, resolved.source, resolved.dirty);
    commitBuffers((current) => ({ ...current, [path]: buffer }));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    const currentProject = projectRef.current;
    publishProject({
      ...currentProject,
      pages: currentProject.pages.map((page) => page.path === path ? {
        ...page,
        contentHash: loaded.contentHash,
        links: loaded.links
      } : page),
      ...(currentProject.activePagePath === path ? {
        activePageNativeDocumentParts: loaded.nativeDocumentParts ?? null
      } : {})
    });
    return true;
  }, [commitBuffers, onRequestConfirmation, projectRef, publishProject, setLoadErrors]);

  useEffect(() => {
    const path = initialProject.activePagePath;
    if (!path || initialProject.activePageSource == null) return;
    const key = `${initialProject.rootPath}\u0000${path}`;
    if (checkedDraftsRef.current.has(key)) return;
    checkedDraftsRef.current.add(key);
    void installLoadedProject(initialProject, true);
  }, [initialProject, installLoadedProject]);

  const openDocument = useCallback((path: string, knownProject?: FractalProject): Promise<boolean> => {
    if (buffersRef.current[path]) return Promise.resolve(true);
    const inFlight = loadingPromisesRef.current.get(path);
    if (inFlight) return inFlight;
    const projectAtStart = projectRef.current;
    const loadPromise = (async () => {
      setLoadingPaths((current) => new Set(current).add(path));
      setLoadErrors((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      try {
        if (knownProject?.activePagePath === path && knownProject.activePageSource != null) {
          return await installLoadedProject(knownProject, true);
        }
        const loaded = await fractalClient.readPage(projectAtStart, path);
        if (projectRef.current.rootPath !== projectAtStart.rootPath) return false;
        return await installLoadedPage(loaded, true);
      } catch (error) {
        setLoadErrors((current) => ({ ...current, [path]: errorMessage(error) }));
        return false;
      } finally {
        loadingPromisesRef.current.delete(path);
        setLoadingPaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    })();
    loadingPromisesRef.current.set(path, loadPromise);
    return loadPromise;
  }, [buffersRef, installLoadedPage, installLoadedProject, projectRef, setLoadErrors, setLoadingPaths]);

  const reloadDocument = useCallback(async (path: string) => {
    setLoadingPaths((current) => new Set(current).add(path));
    try {
      const loaded = await fractalClient.readPage(projectRef.current, path);
      void clearPageDraft(projectRef.current.rootPath, path);
      return await installLoadedPage(loaded, false);
    } catch (error) {
      commitBuffers((current) => {
        const buffer = current[path];
        if (!buffer) return current;
        return { ...current, [path]: { ...buffer, error: errorMessage(error) } };
      });
      return false;
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [commitBuffers, installLoadedPage, projectRef, setLoadingPaths]);

  return { openDocument, reloadDocument };
}
