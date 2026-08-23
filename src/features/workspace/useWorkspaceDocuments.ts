import { useCallback, useEffect, useRef, useState } from "react";
import { clearPageDraft, readPageDraft, writePageDraftSource } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalProject } from "@/lib/fractal/types";

export type DocumentBuffer = {
  path: string;
  source: string;
  links: FractalProject["activePageLinks"];
  backlinks: FractalProject["activePageBacklinks"];
  iframes: FractalProject["activePageIframes"];
  iframeBacklinks: FractalProject["activePageIframeBacklinks"];
  modifiedMs: number | null;
  dirty: boolean;
  revision: number;
  operation: "load" | "save" | null;
  error: string | null;
  conflict: boolean;
};

type Options = {
  autoSave: boolean;
  initialDirty: boolean;
  initialProject: FractalProject;
  onProjectSnapshot: (project: FractalProject) => void;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function bufferFromProject(project: FractalProject, source = project.activePageSource ?? "", dirty = false): DocumentBuffer | null {
  if (!project.activePagePath || project.activePageSource == null) return null;
  return {
    path: project.activePagePath,
    source,
    links: project.activePageLinks,
    backlinks: project.activePageBacklinks,
    iframes: project.activePageIframes,
    iframeBacklinks: project.activePageIframeBacklinks,
    modifiedMs: project.activePageModifiedMs ?? null,
    dirty,
    revision: dirty ? 1 : 0,
    operation: null,
    error: null,
    conflict: false
  };
}

function projectForBuffer(project: FractalProject, buffer: DocumentBuffer): FractalProject {
  return {
    ...project,
    activePagePath: buffer.path,
    activePageSource: buffer.source,
    activePageLinks: buffer.links,
    activePageBacklinks: buffer.backlinks,
    activePageIframes: buffer.iframes,
    activePageIframeBacklinks: buffer.iframeBacklinks,
    activePageModifiedMs: buffer.modifiedMs
  };
}

export function useWorkspaceDocuments({ autoSave, initialDirty, initialProject, onProjectSnapshot, onRequestConfirmation }: Options) {
  const initialBuffer = bufferFromProject(initialProject, initialProject.activePageSource ?? "", initialDirty);
  const [project, setProject] = useState(initialProject);
  const [buffers, setBuffers] = useState<Record<string, DocumentBuffer>>(() => initialBuffer ? { [initialBuffer.path]: initialBuffer } : {});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const projectRef = useRef(project);
  const buffersRef = useRef(buffers);
  const previousRootRef = useRef(initialProject.rootPath);
  projectRef.current = project;
  buffersRef.current = buffers;

  const publishProject = useCallback((next: FractalProject) => {
    projectRef.current = next;
    setProject(next);
    onProjectSnapshot(next);
  }, [onProjectSnapshot]);

  useEffect(() => {
    if (previousRootRef.current !== initialProject.rootPath) {
      previousRootRef.current = initialProject.rootPath;
      const nextBuffer = bufferFromProject(initialProject, initialProject.activePageSource ?? "", initialDirty);
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
    setBuffers((current) => {
      const next = { ...current, [path]: buffer };
      buffersRef.current = next;
      return next;
    });
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    publishProject(loaded);
    return true;
  }, [onRequestConfirmation, publishProject]);

  const openDocument = useCallback(async (path: string, knownProject?: FractalProject) => {
    if (buffersRef.current[path]) return true;
    setLoadingPaths((current) => new Set(current).add(path));
    setLoadErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    try {
      const loaded = knownProject?.activePagePath === path && knownProject.activePageSource != null
        ? knownProject
        : await fractalClient.openPage(projectRef.current, path);
      return await installLoadedProject(loaded, true);
    } catch (error) {
      setLoadErrors((current) => ({ ...current, [path]: errorMessage(error) }));
      return false;
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [installLoadedProject]);

  const updateSource = useCallback((path: string, source: string) => {
    setBuffers((current) => {
      const buffer = current[path];
      if (!buffer) return current;
      const next = {
        ...current,
        [path]: { ...buffer, source, dirty: true, revision: buffer.revision + 1, error: null }
      };
      buffersRef.current = next;
      return next;
    });
  }, []);

  const saveDocument = useCallback(async (path: string, force = false) => {
    const start = buffersRef.current[path];
    if (!start || (!start.dirty && !force)) return true;
    setBuffers((current) => {
      const buffer = current[path];
      if (!buffer) return current;
      const next = { ...current, [path]: { ...buffer, operation: "save" as const, error: null } };
      buffersRef.current = next;
      return next;
    });
    try {
      const snapshot = projectForBuffer(projectRef.current, start);
      const modifiedMs = await fractalClient.pageModifiedMs(snapshot);
      if (!force && start.modifiedMs != null && modifiedMs != null && modifiedMs !== start.modifiedMs) {
        setBuffers((current) => {
          const buffer = current[path];
          if (!buffer) return current;
          const next = {
            ...current,
            [path]: {
              ...buffer,
              operation: null,
              conflict: true,
              error: "This page changed on disk. Reload it or replace the external version."
            }
          };
          buffersRef.current = next;
          return next;
        });
        return false;
      }
      const saved = await fractalClient.writePage(snapshot, start.source);
      const savedBuffer = bufferFromProject(saved);
      if (!savedBuffer) throw new Error(`Fractal did not return ${path} after saving.`);
      setBuffers((current) => {
        const currentBuffer = current[path];
        const hasNewerEdits = Boolean(currentBuffer && currentBuffer.revision !== start.revision);
        const nextBuffer = hasNewerEdits && currentBuffer
          ? { ...savedBuffer, source: currentBuffer.source, dirty: true, revision: currentBuffer.revision }
          : savedBuffer;
        const next = { ...current, [path]: nextBuffer };
        buffersRef.current = next;
        if (!hasNewerEdits) clearPageDraft(saved.rootPath, path);
        return next;
      });
      publishProject(saved);
      return true;
    } catch (error) {
      setBuffers((current) => {
        const buffer = current[path];
        if (!buffer) return current;
        const next = { ...current, [path]: { ...buffer, operation: null, error: errorMessage(error) } };
        buffersRef.current = next;
        return next;
      });
      return false;
    }
  }, [publishProject]);

  const reloadDocument = useCallback(async (path: string) => {
    setLoadingPaths((current) => new Set(current).add(path));
    try {
      const loaded = await fractalClient.openPage(projectRef.current, path);
      clearPageDraft(loaded.rootPath, path);
      return await installLoadedProject(loaded, false);
    } catch (error) {
      setBuffers((current) => {
        const buffer = current[path];
        if (!buffer) return current;
        const next = { ...current, [path]: { ...buffer, error: errorMessage(error) } };
        buffersRef.current = next;
        return next;
      });
      return false;
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, [installLoadedProject]);

  const saveAll = useCallback(async () => {
    const dirtyPaths = Object.values(buffersRef.current).filter((buffer) => buffer.dirty).map((buffer) => buffer.path);
    for (const path of dirtyPaths) {
      if (!(await saveDocument(path))) return false;
    }
    return true;
  }, [saveDocument]);

  const forgetDocument = useCallback((path: string) => {
    setBuffers((current) => {
      const next = { ...current };
      delete next[path];
      buffersRef.current = next;
      return next;
    });
  }, []);

  const renameDocument = useCallback((from: string, to: string) => {
    setBuffers((current) => {
      const buffer = current[from];
      if (!buffer) return current;
      const next = { ...current, [to]: { ...buffer, path: to } };
      delete next[from];
      buffersRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const dirty = Object.values(buffers).filter((buffer) => buffer.dirty);
    if (!dirty.length) return;
    const draftTimeout = window.setTimeout(() => {
      for (const buffer of dirty) writePageDraftSource(project.rootPath, buffer.path, buffer.source);
    }, 180);
    const autoSavePaths = dirty.filter((buffer) => !buffer.conflict).map((buffer) => buffer.path);
    const saveTimeout = autoSave && autoSavePaths.length ? window.setTimeout(() => {
      void (async () => {
        for (const path of autoSavePaths) {
          if (!(await saveDocument(path))) break;
        }
      })();
    }, 900) : null;
    return () => {
      window.clearTimeout(draftTimeout);
      if (saveTimeout != null) window.clearTimeout(saveTimeout);
    };
  }, [autoSave, buffers, project.rootPath, saveDocument]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const snapshot = Object.values(buffersRef.current);
      for (const buffer of snapshot) {
        if (buffer.operation) continue;
        try {
          const modifiedMs = await fractalClient.pageModifiedMs(projectForBuffer(projectRef.current, buffer));
          if (modifiedMs != null && buffer.modifiedMs != null && modifiedMs !== buffer.modifiedMs) {
            setBuffers((current) => {
              const latest = current[buffer.path];
              if (!latest || latest.modifiedMs !== buffer.modifiedMs) return current;
              const next = {
                ...current,
                [buffer.path]: {
                  ...latest,
                  conflict: true,
                  error: "This page changed on disk. Reload it or replace the external version."
                }
              };
              buffersRef.current = next;
              return next;
            });
          }
        } catch {
          // A metadata check should not interrupt writing.
        }
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, []);

  const dirtyCount = Object.values(buffers).filter((buffer) => buffer.dirty).length;
  return {
    buffers,
    dirtyCount,
    forgetDocument,
    loadErrors,
    loadingPaths,
    openDocument,
    project,
    publishProject,
    renameDocument,
    reloadDocument,
    saveAll,
    saveDocument,
    updateSource
  };
}
