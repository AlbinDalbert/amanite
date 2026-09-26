import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { clearPageDraft } from "@/app/pageDrafts";
import { readEditablePage } from "@/features/editor/components/pageSource";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalLoadedPage, FractalProject } from "@/lib/fractal/types";
import { bufferFromLoadedPage, bufferFromProject, errorMessage, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { resolveDocumentDraft } from "./documentDraftRecovery";
import type { DocumentRegistry } from "./documentRuntime";

type MutableValue<T> = { current: T };

type Options = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  documentRegistry?: DocumentRegistry;
  initialProject: FractalProject;
  projectGeneration: number;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
  registerBaseline?: (path: string, source: string, nativeDocumentParts: NonNullable<FractalLoadedPage["nativeDocumentParts"]> | null) => void;
  setLoadErrors: Dispatch<SetStateAction<Record<string, string>>>;
  setLoadingPaths: Dispatch<SetStateAction<Set<string>>>;
};

function loadingKey(projectRoot: string, pagePath: string) {
  return `${projectRoot}\u0000${pagePath}`;
}

export function useDocumentLoading({ buffersRef, commitBuffers, documentRegistry, initialProject, onRequestConfirmation, projectGeneration, projectRef, publishProject, registerBaseline, setLoadErrors, setLoadingPaths }: Options) {
  const initializedProjectsRef = useRef(new Set<string>());
  const loadingPromisesRef = useRef(new Map<string, Promise<boolean>>());

  const installRuntime = useCallback((path: string, source: string, incarnation: number, revision: number) => {
    if (!documentRegistry) return;
    const editable = readEditablePage(source);
    const existing = documentRegistry.getByPath(path);
    if (existing) {
      existing.replaceDocument(editable.bodyHtml, editable.title, incarnation, revision);
      return;
    }
    documentRegistry.openLoaded(path, {
      bodyHtml: editable.bodyHtml,
      initialReplacementGeneration: incarnation,
      initialRevision: revision,
      title: editable.title
    });
  }, [documentRegistry]);

  const installLoadedProject = useCallback(async (loaded: FractalProject, checkDraft: boolean, projectRoot: string) => {
    const path = loaded.activePagePath;
    const expectedBuffer = path ? buffersRef.current[path] : undefined;
    const isCurrent = () => projectRef.current.rootPath === projectRoot
      && (!path || buffersRef.current[path] === expectedBuffer)
      && (loaded.sessionGeneration == null || projectRef.current.sessionGeneration === loaded.sessionGeneration);
    if (!path || loaded.activePageSource == null || loaded.rootPath !== projectRoot || !isCurrent()) return false;
    const resolved = await resolveDocumentDraft({
      checkDraft,
      isCurrent,
      onRequestConfirmation,
      pagePath: path,
      projectRoot,
      source: loaded.activePageSource,
      sourceHash: loaded.activePageContentHash
    });
    if (!isCurrent()) return false;
    const previousIncarnation = buffersRef.current[path]?.incarnation ?? 0;
    const buffer = bufferFromProject(loaded, resolved.source, resolved.dirty, { draftedRevision: resolved.draftedRevision, incarnation: previousIncarnation + 1, projectGeneration, revision: resolved.revision });
    if (!buffer || !isCurrent()) return false;
    installRuntime(path, resolved.source, buffer.incarnation, buffer.revision);
    registerBaseline?.(path, loaded.activePageSource ?? "", loaded.activePageNativeDocumentParts ?? null);
    commitBuffers((current) => ({ ...current, [path]: buffer }));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    publishProject(loaded);
    return true;
  }, [commitBuffers, installRuntime, onRequestConfirmation, projectGeneration, projectRef, publishProject, registerBaseline, setLoadErrors]);

  const installLoadedPage = useCallback(async (loaded: FractalLoadedPage, checkDraft: boolean, projectRoot: string) => {
    const path = loaded.path;
    const expectedBuffer = buffersRef.current[path];
    const isCurrent = () => projectRef.current.rootPath === projectRoot
      && (!path || buffersRef.current[path] === expectedBuffer)
      && (loaded.sessionGeneration == null || projectRef.current.sessionGeneration === loaded.sessionGeneration);
    if (!isCurrent()) return false;
    const resolved = await resolveDocumentDraft({
      checkDraft,
      isCurrent,
      onRequestConfirmation,
      pagePath: path,
      projectRoot,
      source: loaded.source,
      sourceHash: loaded.contentHash
    });
    if (!isCurrent()) return false;
    const previousIncarnation = buffersRef.current[path]?.incarnation ?? 0;
    const buffer = bufferFromLoadedPage(loaded, resolved.source, resolved.dirty, { draftedRevision: resolved.draftedRevision, incarnation: previousIncarnation + 1, projectGeneration, revision: resolved.revision });
    if (!isCurrent()) return false;
    installRuntime(path, resolved.source, buffer.incarnation, buffer.revision);
    registerBaseline?.(path, loaded.source, loaded.nativeDocumentParts ?? null);
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
  }, [commitBuffers, installRuntime, onRequestConfirmation, projectGeneration, projectRef, publishProject, registerBaseline, setLoadErrors]);

  useEffect(() => {
    // Bootstrap recovery belongs to project entry. Later snapshots from saves
    // and renames must never reinstall an already live editor buffer.
    const key = `${initialProject.rootPath}\u0000${projectGeneration}`;
    if (initializedProjectsRef.current.has(key)) return;
    initializedProjectsRef.current.add(key);
    if (!initialProject.activePagePath || initialProject.activePageSource == null) return;
    void installLoadedProject(initialProject, true, initialProject.rootPath);
  }, [initialProject, installLoadedProject, projectGeneration]);

  const openDocument = useCallback((path: string, knownProject?: FractalProject): Promise<boolean> => {
    if (buffersRef.current[path]) return Promise.resolve(true);
    const projectAtStart = projectRef.current;
    const projectRoot = projectAtStart.rootPath;
    const key = loadingKey(projectRoot, path);
    const inFlight = loadingPromisesRef.current.get(key);
    if (inFlight) return inFlight;
    const backendGeneration = projectAtStart.sessionGeneration;
    const isCurrent = () => projectRef.current.rootPath === projectRoot && projectRef.current.sessionGeneration === backendGeneration;
    const operation = { promise: null as Promise<boolean> | null };
    const loadPromise = (async () => {
      setLoadingPaths((current) => new Set(current).add(path));
      setLoadErrors((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      try {
        if (knownProject?.rootPath === projectRoot && knownProject.activePagePath === path && knownProject.activePageSource != null) {
          return await installLoadedProject(knownProject, true, projectRoot);
        }
        const loaded = await fractalClient.readPage(projectAtStart, path);
        if (!isCurrent()) return false;
        return await installLoadedPage(loaded, true, projectRoot);
      } catch (error) {
        if (isCurrent()) setLoadErrors((current) => ({ ...current, [path]: errorMessage(error) }));
        return false;
      } finally {
        if (loadingPromisesRef.current.get(key) === operation.promise) loadingPromisesRef.current.delete(key);
        if (isCurrent()) {
          setLoadingPaths((current) => {
            const next = new Set(current);
            next.delete(path);
            return next;
          });
        }
      }
    })();
    operation.promise = loadPromise;
    loadingPromisesRef.current.set(key, loadPromise);
    return loadPromise;
  }, [buffersRef, installLoadedPage, installLoadedProject, projectGeneration, projectRef, setLoadErrors, setLoadingPaths]);

  const reloadDocument = useCallback(async (path: string) => {
    const projectAtStart = projectRef.current;
    const projectRoot = projectAtStart.rootPath;
    const backendGeneration = projectAtStart.sessionGeneration;
    const isCurrent = () => projectRef.current.rootPath === projectRoot && projectRef.current.sessionGeneration === backendGeneration;
    const expectedBuffer = buffersRef.current[path];
    if (!expectedBuffer) return false;
    commitBuffers((current) => {
      const buffer = current[path];
      return buffer && buffer === expectedBuffer
        ? { ...current, [path]: { ...buffer, operation: "load", error: null } }
        : current;
    });
    setLoadingPaths((current) => new Set(current).add(path));
    try {
      const loaded = await fractalClient.readPage(projectAtStart, path);
      if (!isCurrent()) return false;
      await clearPageDraft(projectRoot, path);
      if (!isCurrent()) return false;
      return await installLoadedPage(loaded, false, projectRoot);
    } catch (error) {
      if (!isCurrent()) return false;
      commitBuffers((current) => {
        const buffer = current[path];
        if (!buffer) return current;
        return { ...current, [path]: { ...buffer, operation: null, error: errorMessage(error), conflict: true } };
      });
      return false;
    } finally {
      if (isCurrent()) {
        commitBuffers((current) => {
          const buffer = current[path];
          return buffer?.operation === "load"
            ? { ...current, [path]: { ...buffer, operation: null } }
            : current;
        });
        setLoadingPaths((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    }
  }, [commitBuffers, installLoadedPage, projectGeneration, projectRef, setLoadingPaths]);

  return { openDocument, reloadDocument };
}
