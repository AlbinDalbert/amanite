import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearPageDraft, readPageDraft } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalLoadedPage, FractalProject } from "@/lib/fractal/types";
import {
  bufferFromLoadedPage,
  bufferFromProject,
  errorMessage,
  type BufferUpdater,
  type DocumentBuffers
} from "./documents/documentBuffers";
import { createDocumentPersistence } from "./documents/documentPersistence";
import { useDocumentDrafts } from "./documents/useDocumentDrafts";
import { useProjectFilePolling } from "./documents/useProjectFilePolling";

export type { DocumentBuffer } from "./documents/documentBuffers";

type Options = {
  autoSave: boolean;
  initialProject: FractalProject;
  onProjectSnapshot: (project: FractalProject) => void;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
};

export function useWorkspaceDocuments({ autoSave, initialProject, onProjectSnapshot, onRequestConfirmation }: Options) {
  const initialBuffer = bufferFromProject(initialProject);
  const [project, setProject] = useState(initialProject);
  const [buffers, setBuffers] = useState<DocumentBuffers>(() => initialBuffer ? { [initialBuffer.path]: initialBuffer } : {});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [pollingNotice, setPollingNotice] = useState<{ id: number; message: string } | null>(null);
  const projectRef = useRef(project);
  const buffersRef = useRef(buffers);
  const previousRootRef = useRef(initialProject.rootPath);
  const checkedDraftsRef = useRef(new Set<string>());
  const loadingPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const lastPollingNoticeRef = useRef(0);

  const commitBuffers = useCallback((updater: BufferUpdater) => {
    const next = updater(buffersRef.current);
    if (next === buffersRef.current) return;
    buffersRef.current = next;
    startTransition(() => setBuffers(next));
  }, []);

  const publishProject = useCallback((next: FractalProject) => {
    projectRef.current = next;
    setProject(next);
    onProjectSnapshot(next);
  }, [onProjectSnapshot]);

  const persistence = useMemo(() => createDocumentPersistence({
    buffersRef,
    commitBuffers,
    projectRef,
    publishProject
  }), [commitBuffers, publishProject]);

  useEffect(() => {
    if (previousRootRef.current !== initialProject.rootPath) {
      previousRootRef.current = initialProject.rootPath;
      const nextBuffer = bufferFromProject(initialProject);
      const nextBuffers = nextBuffer ? { [nextBuffer.path]: nextBuffer } : {};
      projectRef.current = initialProject;
      buffersRef.current = nextBuffers;
      setProject(initialProject);
      setBuffers(nextBuffers);
      setLoadingPaths(new Set());
      setLoadErrors({});
      return;
    }
    projectRef.current = initialProject;
    setProject(initialProject);
  }, [initialProject]);

  const installLoadedProject = useCallback(async (loaded: FractalProject, checkDraft: boolean) => {
    const path = loaded.activePagePath;
    if (!path || loaded.activePageSource == null) return false;
    let source = loaded.activePageSource;
    let dirty = false;
    const draft = checkDraft ? readPageDraft(loaded.rootPath, path) : null;
    if (draft && draft.source !== source) {
      const recover = await onRequestConfirmation(`Recover the unsaved draft for ${path}?`, "Recover draft");
      if (recover) {
        source = draft.source;
        dirty = true;
      } else {
        clearPageDraft(loaded.rootPath, path);
      }
    } else if (draft) {
      clearPageDraft(loaded.rootPath, path);
    }
    const buffer = bufferFromProject(loaded, source, dirty);
    if (!buffer) return false;
    commitBuffers((current) => ({ ...current, [path]: buffer }));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    publishProject(loaded);
    return true;
  }, [commitBuffers, onRequestConfirmation, publishProject]);

  const installLoadedPage = useCallback(async (loaded: FractalLoadedPage, checkDraft: boolean) => {
    const path = loaded.path;
    const rootPath = projectRef.current.rootPath;
    let source = loaded.source;
    let dirty = false;
    const draft = checkDraft ? readPageDraft(rootPath, path) : null;
    if (draft && draft.source !== source) {
      const recover = await onRequestConfirmation(`Recover the unsaved draft for ${path}?`, "Recover draft");
      if (recover) {
        source = draft.source;
        dirty = true;
      } else {
        clearPageDraft(rootPath, path);
      }
    } else if (draft) {
      clearPageDraft(rootPath, path);
    }
    const buffer = bufferFromLoadedPage(loaded, source, dirty);
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
        iframes: loaded.iframes,
        links: loaded.links
      } : page)
    });
    return true;
  }, [commitBuffers, onRequestConfirmation, publishProject]);

  useEffect(() => {
    const path = initialProject.activePagePath;
    if (!path || initialProject.activePageSource == null) return;
    const key = `${initialProject.rootPath}\u0000${path}`;
    if (checkedDraftsRef.current.has(key)) return;
    checkedDraftsRef.current.add(key);
    void installLoadedProject(initialProject, true);
  }, [initialProject.activePagePath, initialProject.activePageSource, initialProject.rootPath, installLoadedProject]);

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
  }, [installLoadedPage, installLoadedProject]);

  const updateSource = useCallback((path: string, source: string) => {
    commitBuffers((current) => {
      const buffer = current[path];
      if (!buffer) return current;
      return {
        ...current,
        [path]: { ...buffer, source, dirty: true, revision: buffer.revision + 1, error: null }
      };
    });
  }, [commitBuffers]);

  const reloadDocument = useCallback(async (path: string) => {
    setLoadingPaths((current) => new Set(current).add(path));
    try {
      const loaded = await fractalClient.readPage(projectRef.current, path);
      clearPageDraft(projectRef.current.rootPath, path);
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
  }, [commitBuffers, installLoadedPage]);

  const forgetDocument = useCallback((path: string) => {
    commitBuffers((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, [commitBuffers]);

  const renameDocument = useCallback((from: string, to: string) => {
    commitBuffers((current) => {
      const buffer = current[from];
      if (!buffer) return current;
      const next = { ...current, [to]: { ...buffer, path: to } };
      delete next[from];
      return next;
    });
  }, [commitBuffers]);

  const refreshChangedDocuments = useCallback(async (snapshot: FractalProject, ignoredPaths: string[] = []) => {
    const ignored = new Set(ignoredPaths);
    const pageHashes = new Map(snapshot.pages.map((page) => [page.path, page.contentHash]));
    const changed = Object.values(buffersRef.current).filter((buffer) =>
      !ignored.has(buffer.path)
      && pageHashes.has(buffer.path)
      && pageHashes.get(buffer.path) !== buffer.contentHash
    );
    let refreshed = true;
    for (const checked of changed) {
      const latest = buffersRef.current[checked.path];
      if (!latest) continue;
      if (latest.dirty || latest.operation) {
        refreshed = false;
        commitBuffers((current) => {
          const buffer = current[checked.path];
          if (!buffer) return current;
          return {
            ...current,
            [checked.path]: {
              ...buffer,
              conflict: true,
              error: "This page was updated by the project move while it also had local changes. Reload it or replace the disk version."
            }
          };
        });
      } else if (!(await reloadDocument(checked.path))) {
        refreshed = false;
      }
    }
    return refreshed;
  }, [commitBuffers, reloadDocument]);

  const reportPollingError = useCallback((message: string) => {
    const now = Date.now();
    if (now - lastPollingNoticeRef.current < 15_000) return;
    lastPollingNoticeRef.current = now;
    setPollingNotice({ id: now, message });
  }, []);

  useEffect(() => {
    if (!pollingNotice) return;
    const timeout = window.setTimeout(() => setPollingNotice((current) => current?.id === pollingNotice.id ? null : current), 5000);
    return () => window.clearTimeout(timeout);
  }, [pollingNotice]);

  useDocumentDrafts({
    autoSave,
    buffers,
    projectRoot: project.rootPath,
    saveDocument: persistence.saveDocument
  });
  useProjectFilePolling({ buffersRef, commitBuffers, onError: reportPollingError, projectRef });

  const dirtyCount = Object.values(buffers).filter((buffer) => buffer.dirty).length;
  return {
    buffers,
    dirtyCount,
    forgetDocument,
    loadErrors,
    loadingPaths,
    openDocument,
    project,
    pollingNotice,
    publishProject,
    refreshChangedDocuments,
    renameDocument,
    reloadDocument,
    saveAll: persistence.saveAll,
    saveDocument: persistence.saveDocument,
    dismissPollingNotice: () => setPollingNotice(null),
    updateSource
  };
}
