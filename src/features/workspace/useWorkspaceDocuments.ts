import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearPageDraft } from "@/app/pageDrafts";
import { requestEditorFlush } from "@/features/editor/components/editorFlush";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalNativeSection, FractalProject } from "@/lib/fractal/types";
import {
  bufferFromProject,
  errorMessage,
  nativeEditsFromSource,
  type BufferUpdater,
  type DocumentBuffers
} from "./documents/documentBuffers";
import { createDocumentPersistence } from "./documents/documentPersistence";
import { createProjectGeneration } from "./documents/documentSessions";
import { useDocumentDrafts } from "./documents/useDocumentDrafts";
import { useDocumentLoading } from "./documents/useDocumentLoading";
import { useProjectFilePolling } from "./documents/useProjectFilePolling";

export type { DocumentBuffer } from "./documents/documentBuffers";

type Options = {
  autoSave: boolean;
  initialProject: FractalProject;
  projectGeneration?: number;
  onProjectSnapshot: (project: FractalProject) => void;
  onDocumentPathChange: (from: string, to: string) => void;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
};

function useWorkspaceDocumentState(initialProject: FractalProject, requestedGeneration?: number) {
  const [projectGeneration] = useState(() => requestedGeneration ?? initialProject.sessionGeneration ?? createProjectGeneration());
  const initialBuffer = bufferFromProject(initialProject, initialProject.activePageSource ?? "", false, { projectGeneration });
  const [project, setProject] = useState(() => ({ ...initialProject, sessionGeneration: projectGeneration }));
  const [buffers, setBuffers] = useState<DocumentBuffers>(() => initialBuffer ? { [initialBuffer.path]: initialBuffer } : {});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(() => new Set());
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [pollingNotice, setPollingNotice] = useState<{ id: number; message: string } | null>(null);
  const [draftStorageError, setDraftStorageError] = useState<string | null>(null);
  const projectRef = useRef(project);
  const buffersRef = useRef(buffers);
  const previousRootRef = useRef(initialProject.rootPath);
  const previousGenerationRef = useRef(projectGeneration);
  const lastPollingNoticeRef = useRef(0);

  return {
    buffers,
    buffersRef,
    draftStorageError,
    lastPollingNoticeRef,
    loadErrors,
    loadingPaths,
    pollingNotice,
    previousRootRef,
    previousGenerationRef,
    projectGeneration,
    project,
    projectRef,
    setBuffers,
    setDraftStorageError,
    setLoadErrors,
    setLoadingPaths,
    setPollingNotice,
    setProject
  };
}

export function useWorkspaceDocuments({ autoSave, initialProject, onDocumentPathChange, onProjectSnapshot, onRequestConfirmation, projectGeneration: requestedGeneration }: Options) {
  const {
    buffers,
    buffersRef,
    draftStorageError,
    lastPollingNoticeRef,
    loadErrors,
    loadingPaths,
    pollingNotice,
    previousRootRef,
    projectGeneration,
    previousGenerationRef,
    project,
    projectRef,
    setBuffers,
    setDraftStorageError,
    setLoadErrors,
    setLoadingPaths,
    setPollingNotice,
    setProject
  } = useWorkspaceDocumentState(initialProject, requestedGeneration);
  const reportedRevisionRef = useRef(new Set<string>());

  const commitBuffers = useCallback((updater: BufferUpdater) => {
    const next = updater(buffersRef.current);
    if (next === buffersRef.current) return;
    buffersRef.current = next;
    startTransition(() => setBuffers(next));
  }, []);

  const publishProject = useCallback((next: FractalProject) => {
    const tagged = { ...next, sessionGeneration: projectGeneration };
    projectRef.current = tagged;
    setProject(tagged);
    onProjectSnapshot(tagged);
  }, [onProjectSnapshot, projectGeneration]);

  const persistence = useMemo(() => createDocumentPersistence({
    buffersRef,
    commitBuffers,
    flushDocument: (buffer) => requestEditorFlush(buffer.path),
    onDocumentPathChange,
    onDraftStorageError: setDraftStorageError,
    projectRef,
    publishProject
  }), [commitBuffers, onDocumentPathChange, publishProject, setDraftStorageError]);

  useEffect(() => {
    if (previousRootRef.current !== initialProject.rootPath || previousGenerationRef.current !== projectGeneration) {
      previousRootRef.current = initialProject.rootPath;
      previousGenerationRef.current = projectGeneration;
      const nextBuffer = bufferFromProject(initialProject, initialProject.activePageSource ?? "", false, { projectGeneration });
      const nextBuffers = nextBuffer ? { [nextBuffer.path]: nextBuffer } : {};
      const tagged = { ...initialProject, sessionGeneration: projectGeneration };
      projectRef.current = tagged;
      buffersRef.current = nextBuffers;
      setProject(tagged);
      setBuffers(nextBuffers);
      setLoadingPaths(new Set());
      setLoadErrors({});
      return;
    }
    const tagged = { ...initialProject, sessionGeneration: projectGeneration };
    projectRef.current = tagged;
    setProject(tagged);
  }, [initialProject, previousGenerationRef, previousRootRef, projectGeneration]);

  const { openDocument, reloadDocument } = useDocumentLoading({
    buffersRef,
    commitBuffers,
    initialProject,
    onRequestConfirmation,
    projectGeneration,
    projectRef,
    publishProject,
    setLoadErrors,
    setLoadingPaths
  });

  const markRevision = useCallback((path: string) => {
    reportedRevisionRef.current.add(path);
    commitBuffers((current) => {
      const buffer = current[path];
      return buffer
        ? { ...current, [path]: { ...buffer, dirty: true, revision: buffer.revision + 1, error: null } }
        : current;
    });
  }, [commitBuffers]);

  const updateSource = useCallback((path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => {
    commitBuffers((current) => {
      const buffer = current[path];
      if (!buffer) return current;
      let nativeEdits = buffer.nativeEdits;
      if (buffer.nativeDocumentParts) {
        nativeEdits = nativeSection
          ? { ...buffer.nativeEdits, [nativeSection.section]: nativeSection.value }
          : nativeEditsFromSource(source, buffer.nativeDocumentParts);
      }
      const reported = reportedRevisionRef.current.has(path);
      reportedRevisionRef.current.delete(path);
      return {
        ...current,
        [path]: { ...buffer, source, nativeEdits, dirty: true, revision: buffer.revision + (reported ? 0 : 1), error: null }
      };
    });
  }, [commitBuffers]);

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

  const recreateDocument = useCallback(async (path: string) => {
    const buffer = buffersRef.current[path];
    if (!buffer?.missing) return false;
    try {
      const result = await fractalClient.recreatePage(projectRef.current, path, buffer.source);
      const resultingPath = result.project.activePagePath ?? path;
      if (resultingPath !== path) renameDocument(path, resultingPath);
      publishProject(result.project);
      await clearPageDraft(result.project.rootPath, path);
      return reloadDocument(resultingPath);
    } catch (error) {
      commitBuffers((current) => current[path] ? { ...current, [path]: { ...current[path], error: errorMessage(error), conflict: true } } : current);
      return false;
    }
  }, [commitBuffers, publishProject, reloadDocument, renameDocument]);

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
    saveDocument: persistence.saveDocument,
    onStorageError: setDraftStorageError
  });
  useProjectFilePolling({ buffersRef, commitBuffers, onError: reportPollingError, projectRef });

  const dirtyCount = Object.values(buffers).filter((buffer) => buffer.dirty).length;
  return {
    buffers,
    dirtyCount,
    draftStorageError,
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
    recreateDocument,
    saveAll: persistence.saveAll,
    saveDocument: persistence.saveDocument,
    dismissPollingNotice: () => setPollingNotice(null),
    markRevision,
    updateSource
  };
}
