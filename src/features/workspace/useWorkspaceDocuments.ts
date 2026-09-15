import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearPageDraft } from "@/app/pageDrafts";
import { requestEditorSnapshot, type EditorSnapshot } from "@/features/editor/components/editorFlush";
import { writeEditablePage } from "@/features/editor/components/pageSource";
import { fractalClient } from "@/lib/fractal/client";
import { mapPagePath, reconcileMutationResult } from "@/lib/fractal/reconcile";
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
import { DocumentQueryIndex, type LiveDocumentModel } from "./documentQueryIndex";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";

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
  const pathAliasesRef = useRef(new Map<string, string>());
  const [liveModels, setLiveModels] = useState<Record<string, EditorModelSnapshot>>({});
  const liveModelsRef = useRef(liveModels);
  const [documentQueries] = useState(() => new DocumentQueryIndex(initialProject.pages, (query, limit) =>
    fractalClient.searchProject(projectRef.current, query, limit)));

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

  const rememberPathChange = useCallback((from: string, to: string) => {
    for (const [alias, target] of pathAliasesRef.current) {
      if (target === from) pathAliasesRef.current.set(alias, to);
    }
    pathAliasesRef.current.set(from, to);
  }, []);

  const notifyDocumentPathChange = useCallback((from: string, to: string) => {
    rememberPathChange(from, to);
    onDocumentPathChange(from, to);
  }, [onDocumentPathChange, rememberPathChange]);

  const persistence = useMemo(() => createDocumentPersistence({
    buffersRef,
    commitBuffers,
    flushDocument: (buffer) => requestEditorSnapshot(buffer.documentId, buffer.revision),
    onDocumentPathChange: notifyDocumentPathChange,
    onDraftStorageError: setDraftStorageError,
    projectRef,
    publishProject
  }), [commitBuffers, notifyDocumentPathChange, publishProject, setDraftStorageError]);

  useEffect(() => {
    if (previousRootRef.current !== initialProject.rootPath || previousGenerationRef.current !== projectGeneration) {
      previousRootRef.current = initialProject.rootPath;
      previousGenerationRef.current = projectGeneration;
      const nextBuffer = bufferFromProject(initialProject, initialProject.activePageSource ?? "", false, { projectGeneration });
      const nextBuffers = nextBuffer ? { [nextBuffer.path]: nextBuffer } : {};
      const tagged = { ...initialProject, sessionGeneration: projectGeneration };
      projectRef.current = tagged;
      buffersRef.current = nextBuffers;
      pathAliasesRef.current.clear();
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

  const markRevision = useCallback((path: string, revision?: number) => {
    reportedRevisionRef.current.add(path);
    commitBuffers((current) => {
      const buffer = current[path];
      return buffer
        ? { ...current, [path]: { ...buffer, dirty: true, revision: Math.max(buffer.revision + 1, revision ?? 0), draftError: null, error: null } }
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
      const sectionTitle = nativeSection?.section === "title" ? nativeSection.value : buffer.title;
      const sectionBody = nativeSection?.section === "content" ? nativeSection.value : buffer.bodyHtml;
      const shouldKeepCurrentSource = nativeSection?.section === "title" && source === buffer.source;
      return {
        ...current,
        [path]: {
          ...buffer,
          source: shouldKeepCurrentSource ? buffer.source : source,
          title: sectionTitle,
          bodyHtml: sectionBody,
          nativeEdits,
          dirty: true,
          revision: buffer.revision + (reported ? 0 : 1),
          draftError: null,
          error: null
        }
      };
    });
  }, [commitBuffers]);

  const updateSnapshot = useCallback((path: string, snapshot: EditorSnapshot) => {
    commitBuffers((current) => {
      const buffer = current[path];
      if (!buffer
        || snapshot.documentId !== buffer.documentId
        || snapshot.projectGeneration !== buffer.projectGeneration
        || snapshot.incarnation < buffer.incarnation
        || snapshot.revision < buffer.snapshotRevision) return current;
      const source = writeEditablePage(buffer.source, buffer.title, snapshot.bodyHtml, buffer.hasTitleHeading);
      return {
        ...current,
        [path]: {
          ...buffer,
          source,
          bodyHtml: snapshot.bodyHtml,
          incarnation: Math.max(buffer.incarnation, snapshot.incarnation),
          nativeEdits: buffer.nativeDocumentParts ? { ...buffer.nativeEdits, content: snapshot.bodyHtml } : buffer.nativeEdits,
          dirty: true,
          snapshotRevision: snapshot.revision,
          error: null
        }
      };
    });
  }, [commitBuffers]);

  const confirmDraft = useCallback((documentId: string, revision: number) => {
    commitBuffers((current) => {
      const path = Object.keys(current).find((candidate) => current[candidate].documentId === documentId);
      if (!path) return current;
      const buffer = current[path];
      if (revision <= buffer.draftedRevision && !buffer.draftError) return current;
      return { ...current, [path]: { ...buffer, draftedRevision: Math.max(buffer.draftedRevision, revision), draftError: null } };
    });
    setDraftStorageError(null);
  }, [commitBuffers, setDraftStorageError]);

  const reportDraftError = useCallback((documentId: string, message: string) => {
    commitBuffers((current) => {
      const path = Object.keys(current).find((candidate) => current[candidate].documentId === documentId);
      if (!path) return current;
      const buffer = current[path];
      return buffer.draftError === message ? current : { ...current, [path]: { ...buffer, draftError: message } };
    });
    setDraftStorageError(message);
  }, [commitBuffers, setDraftStorageError]);

  const forgetDocument = useCallback((path: string) => {
    for (const [alias, target] of pathAliasesRef.current) {
      if (alias === path || target === path) pathAliasesRef.current.delete(alias);
    }
    commitBuffers((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
  }, [commitBuffers]);

  const renameDocument = useCallback((from: string, to: string) => {
    rememberPathChange(from, to);
    commitBuffers((current) => {
      const buffer = current[from];
      if (!buffer) return current;
      const next = { ...current, [to]: { ...buffer, path: to } };
      delete next[from];
      return next;
    });
  }, [commitBuffers, rememberPathChange]);

  const resolveDocumentPath = useCallback((path: string) => {
    let current = path;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      if (buffersRef.current[current]) return current;
      const next = pathAliasesRef.current.get(current);
      if (!next) break;
      current = next;
    }
    return buffersRef.current[current] ? current : null;
  }, [buffersRef]);

  const pagePathsInFolder = useCallback((folderPath: string) => {
    const normalized = folderPath.trim().replace(/^\/+|\/+$/g, "");
    const prefix = normalized ? `${normalized}/` : "";
    return projectRef.current.pages
      .map((page) => page.path)
      .filter((path) => !prefix || path.startsWith(prefix));
  }, [projectRef]);

  const saveFolder = useCallback((folderPath: string) => persistence.savePaths(pagePathsInFolder(folderPath)), [pagePathsInFolder, persistence.savePaths]);

  const updateModel = useCallback((path: string, snapshot: EditorModelSnapshot) => {
    const buffer = buffersRef.current[path];
    if (!buffer || snapshot.revision > buffer.revision) return;
    const previous = liveModelsRef.current[buffer.documentId];
    if (previous && snapshot.revision <= previous.revision) return;
    const next = { ...liveModelsRef.current, [buffer.documentId]: snapshot };
    liveModelsRef.current = next;
    setLiveModels(next);
  }, [buffersRef]);

  const recreateDocument = useCallback(async (path: string) => {
    const buffer = buffersRef.current[path];
    if (!buffer?.missing) return false;
    try {
      const result = await fractalClient.recreatePage(projectRef.current, path, buffer.source);
      const reconciled = reconcileMutationResult(projectRef.current, result);
      const mappedPath = mapPagePath(path, reconciled.scope.mappings);
      const resultingPath = mappedPath === path ? reconciled.result.project.activePagePath ?? path : mappedPath;
      if (resultingPath !== path) renameDocument(path, resultingPath);
      if (resultingPath !== path) notifyDocumentPathChange(path, resultingPath);
      publishProject(reconciled.result.project);
      await clearPageDraft(reconciled.result.project.rootPath, path);
      return reloadDocument(resultingPath);
    } catch (error) {
      commitBuffers((current) => current[path] ? { ...current, [path]: { ...current[path], error: errorMessage(error), conflict: true } } : current);
      return false;
    }
  }, [commitBuffers, notifyDocumentPathChange, publishProject, reloadDocument, renameDocument]);

  const refreshChangedDocuments = useCallback(async (snapshot: FractalProject, ignoredPaths: string[] = []) => {
    const ignored = new Set(ignoredPaths);
    const pageHashes = new Map(snapshot.pages.map((page) => [page.path, page.contentHash]));
    const changed = Object.values(buffersRef.current).filter((buffer) =>
      !ignored.has(buffer.path)
      && (!pageHashes.has(buffer.path) || pageHashes.get(buffer.path) !== buffer.contentHash)
    );
    let refreshed = true;
    for (const checked of changed) {
      const latest = buffersRef.current[checked.path];
      if (!latest) continue;
      if (!pageHashes.has(checked.path)) {
        refreshed = false;
        commitBuffers((current) => {
          const buffer = current[checked.path];
          if (!buffer || (buffer.missing && buffer.error)) return current;
          return {
            ...current,
            [checked.path]: {
              ...buffer,
              conflict: true,
              missing: true,
              error: "This page is absent from the refreshed project catalog. Resolve the local document before closing it."
            }
          };
        });
        continue;
      }
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
    onDraftConfirmed: confirmDraft,
    onDraftError: reportDraftError,
    onStorageError: setDraftStorageError
  });
  useProjectFilePolling({ buffersRef, commitBuffers, onError: reportPollingError, projectRef });

  documentQueries.updateCatalog(project.pages, project.catalogVersion, project.sessionGeneration);
  const liveDocuments: LiveDocumentModel[] = Object.values(buffers).flatMap((buffer) => {
    const model = liveModels[buffer.documentId];
    return model ? [{ documentId: buffer.documentId, dirty: buffer.dirty, links: buffer.links, model, path: buffer.path, title: buffer.title }] : [];
  });
  documentQueries.syncLiveDocuments(liveDocuments);

  const dirtyCount = Object.values(buffers).filter((buffer) => buffer.dirty).length;
  return {
    buffers,
    dirtyCount,
    documentQueries,
    draftStorageError,
    forgetDocument,
    loadErrors,
    loadingPaths,
    openDocument,
    project,
    pollingNotice,
    publishProject,
    pagePathsInFolder,
    refreshChangedDocuments,
    renameDocument,
    reloadDocument,
    recreateDocument,
    saveAll: persistence.saveAll,
    saveFolder,
    savePaths: persistence.savePaths,
    saveDocument: persistence.saveDocument,
    resolveDocumentPath,
    dismissPollingNotice: () => setPollingNotice(null),
    markRevision,
    updateSnapshot,
    updateSource,
    updateModel
  };
}
