import { clearPageDraft, reconcilePageDrafts, writePageDraftSource, type PageDraftWriteResult } from "@/app/pageDrafts";
import { fractalClient, isFractalCommandError } from "@/lib/fractal/client";
import type { FractalNativeDocumentParts, FractalNativeSection, FractalNativeSectionEdits, FractalProject } from "@/lib/fractal/types";
import { mapPagePath, mutationScope, reconcileMutationResult, reconcileProjectSnapshot } from "@/lib/fractal/reconcile";
import type { FractalMutationReceipt } from "@/lib/fractal/types";
import type { EditorSnapshot } from "@/features/editor/components/editorFlush";
import { writeEditablePage } from "@/features/editor/components/pageSource";
import {
  errorMessage,
  type BufferUpdater,
  type DocumentBuffer,
  type DocumentBuffers
} from "./documentBuffers";
import { captureAndEncodeDocument, captureDocument } from "./documentEncoding";
import type { DocumentRegistry } from "./documentRuntime";

type MutableValue<T> = { current: T };

type PersistenceOptions = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  documentRegistry?: DocumentRegistry;
  flushDocument?: (buffer: DocumentBuffer) => EditorSnapshot | null | void | Promise<EditorSnapshot | null | void>;
  onDocumentPathChange: (from: string, to: string) => void;
  onDraftStorageError?: (message: string) => void;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
};

export type RecoveryDraftWriter = (documentId: string, targetRevision: number) => Promise<PageDraftWriteResult | null>;

const nativeSectionOrder: FractalNativeSection[] = ["title", "content", "style", "metadata"];

function projectForBuffer(project: FractalProject, buffer: DocumentBuffer): FractalProject {
  return { ...project, activePagePath: buffer.path };
}

function pageForProject(project: FractalProject, path: string) {
  return project.pages.find((page) => page.path === path);
}

function sectionHash(parts: FractalNativeDocumentParts, section: FractalNativeSection) {
  switch (section) {
    case "title": return parts.titleHash;
    case "content": return parts.contentHash;
    case "style": return parts.styleHash;
    case "metadata": return parts.metadataHash;
  }
}

function applySection(
  project: FractalProject,
  section: FractalNativeSection,
  value: string,
  expectedHash: string
) {
  switch (section) {
    case "title": return fractalClient.setPageTitle(project, value, expectedHash);
    case "content": return fractalClient.setPageContent(project, value, expectedHash);
    case "style": return fractalClient.setPageStyle(project, value, expectedHash);
    case "metadata": return fractalClient.setPageMetadata(project, value, expectedHash);
  }
}

export type NativeSaveResult =
  | { kind: "saved"; outcome?: "saved"; project: FractalProject; sent: FractalNativeSectionEdits; resultingPath: string; receipts?: FractalMutationReceipt[] }
  | { kind: "conflict"; outcome?: "conflict"; message: string; project: FractalProject; sent: FractalNativeSectionEdits; resultingPath: string; receipts?: FractalMutationReceipt[] }
  | {
    kind: "failed";
    outcome?: "failed" | "mutation_committed" | "indeterminate" | "recovery_required";
    code?: string;
    message: string;
    project: FractalProject;
    sent: FractalNativeSectionEdits;
    resultingPath: string;
    receipts?: FractalMutationReceipt[];
  };

async function saveNativeDocument(
  project: FractalProject,
  buffer: DocumentBuffer,
  force: boolean
): Promise<NativeSaveResult> {
  let workingProject = projectForBuffer(project, buffer);
  let parts = buffer.nativeDocumentParts;
  if (force) {
    const latest = await fractalClient.readPage(workingProject, buffer.path);
    parts = latest.nativeDocumentParts ?? null;
  }
  if (!parts) throw new Error(`Fractal did not provide native document sections for ${buffer.path}.`);

  // Every section must be checked against the same snapshot. A preceding
  // title mutation returns a fresh project snapshot, which may include an
  // external content edit. Using that returned content hash would turn a
  // stale local content write into an unconditional overwrite.
  const expectedParts = parts;
  const sent: FractalNativeSectionEdits = {};
  const receipts: FractalMutationReceipt[] = [];
  let resultingPath = buffer.path;
  const projectAfterCommittedSections = () => Object.keys(sent).length ? workingProject : project;
  for (const section of nativeSectionOrder) {
    const value = buffer.nativeEdits[section];
    if (value == null) continue;
    try {
      const result = await applySection(workingProject, section, value, sectionHash(expectedParts, section));
      if (result.status === "conflict") {
        return { kind: "conflict", outcome: "conflict", message: result.error.message, project: projectAfterCommittedSections(), sent, resultingPath, receipts };
      }
      sent[section] = value;
      const reconciled = reconcileMutationResult(workingProject, result.result);
      receipts.push(reconciled.result.receipt);
      resultingPath = mapPagePath(resultingPath, reconciled.scope.mappings);
      workingProject = reconciled.result.project;
    } catch (error) {
      const code = isFractalCommandError(error) ? error.code : undefined;
      const outcome = code === "mutation_committed" || code === "indeterminate" || code === "recovery_required"
        ? code
        : "failed";
      let reconciledProject = projectAfterCommittedSections();
      if (outcome === "mutation_committed" || outcome === "indeterminate" || outcome === "recovery_required") {
        try {
          reconciledProject = await fractalClient.openProjectPath(project.rootPath);
        } catch {
          // Keep the local buffer and the last known project when inspection cannot complete.
        }
      }
      return { kind: "failed", outcome, code, message: errorMessage(error), project: reconciledProject, sent, resultingPath, receipts };
    }
  }
  return { kind: "saved", outcome: "saved", project: projectAfterCommittedSections(), sent, resultingPath, receipts };
}

function mergeSavedProject(
  currentProject: FractalProject,
  savedProject: FractalProject,
  path: string,
  resultingPath: string,
  source: string,
  useSavedSource: boolean
) {
  const wasActive = currentProject.activePagePath === path;
  const reconciled = reconcileProjectSnapshot(currentProject, savedProject);
  return {
    ...reconciled,
    ...(wasActive ? {
      activePagePath: resultingPath,
      activePageSource: useSavedSource ? savedProject.activePageSource : source,
      activePageLinks: savedProject.activePageLinks,
      activePageBacklinks: savedProject.activePageBacklinks,
      activePageContentHash: savedProject.activePageContentHash,
      activePageNativeDocumentParts: savedProject.activePageNativeDocumentParts ?? null
    } : {})
  };
}

function pendingNativeEdits(currentEdits: FractalNativeSectionEdits, sent: FractalNativeSectionEdits, removeSentSections = false) {
  const remaining = { ...currentEdits };
  for (const section of Object.keys(sent) as FractalNativeSection[]) {
    if (removeSentSections || remaining[section] === sent[section]) delete remaining[section];
  }
  return remaining;
}

const nativeSectionValueKeys: Record<FractalNativeSection, keyof FractalNativeDocumentParts> = {
  title: "title",
  content: "contentHtml",
  style: "styleCss",
  metadata: "metadataHtml"
};

const nativeSectionHashKeys: Record<FractalNativeSection, keyof FractalNativeDocumentParts> = {
  title: "titleHash",
  content: "contentHash",
  style: "styleHash",
  metadata: "metadataHash"
};

function mergeAcknowledgedNativeParts(
  current: FractalNativeDocumentParts | null,
  saved: FractalNativeDocumentParts | null,
  sent: FractalNativeSectionEdits
) {
  if (!current || !saved) return current ?? saved;
  const next = { ...current };
  for (const section of Object.keys(sent) as FractalNativeSection[]) {
    next[nativeSectionValueKeys[section]] = saved[nativeSectionValueKeys[section]];
    next[nativeSectionHashKeys[section]] = saved[nativeSectionHashKeys[section]];
  }
  return next;
}

export function nextDocumentBuffer(currentBuffer: DocumentBuffer, start: DocumentBuffer, result: NativeSaveResult, savedProject: FractalProject, resultingPath: string, sent: FractalNativeSectionEdits, directCapture = false) {
  const hasNewerEdits = directCapture ? currentBuffer.revision > start.revision : currentBuffer.revision !== start.revision;
  const remainingEdits = pendingNativeEdits(currentBuffer.nativeEdits, sent, directCapture && !hasNewerEdits);
  const hasPendingNativeEdits = Object.keys(remainingEdits).length > 0;
  const failed = result.kind !== "saved";
  const savedPage = pageForProject(savedProject, resultingPath);
  const fullyAcknowledged = result.kind === "saved" && !hasPendingNativeEdits && !hasNewerEdits;
  const savedParts = savedProject.activePageNativeDocumentParts ?? null;
  const acknowledgedParts = fullyAcknowledged
    ? savedParts ?? currentBuffer.nativeDocumentParts
    : mergeAcknowledgedNativeParts(currentBuffer.nativeDocumentParts, savedParts, sent);
  return {
    ...currentBuffer,
    ...(directCapture && fullyAcknowledged ? { bodyHtml: start.bodyHtml, title: start.title } : {}),
    path: resultingPath,
    revision: directCapture ? Math.max(currentBuffer.revision, start.revision) : currentBuffer.revision,
    source: failed || hasPendingNativeEdits || hasNewerEdits
      ? currentBuffer.source
      : savedProject.activePageSource ?? currentBuffer.source,
    links: savedProject.activePageLinks,
    backlinks: savedProject.activePageBacklinks,
    contentHash: fullyAcknowledged
      ? savedPage?.contentHash ?? savedProject.activePageContentHash ?? currentBuffer.contentHash
      : currentBuffer.contentHash,
    baseSource: fullyAcknowledged ? savedProject.activePageSource ?? currentBuffer.baseSource : currentBuffer.baseSource,
    nativeDocumentParts: acknowledgedParts,
    nativeEdits: remainingEdits,
    conflict: result.kind === "conflict",
    dirty: failed || hasPendingNativeEdits || hasNewerEdits,
    savedRevision: fullyAcknowledged ? Math.max(currentBuffer.savedRevision, start.revision) : currentBuffer.savedRevision,
    operationOutcome: result.kind === "saved"
      ? "saved"
      : result.kind === "conflict"
        ? "conflict"
        : result.outcome === "mutation_committed" || result.outcome === "indeterminate" || result.outcome === "recovery_required"
          ? result.outcome
          : Object.keys(sent).length ? "partial" : "failed",
    error: result.kind === "conflict"
      ? "This page changed on disk. Reload it or replace the external version."
      : result.kind === "failed" ? result.message : null,
    operation: null
  } satisfies DocumentBuffer;
}

function updateBufferAfterSave({ clearDraft, current, currentPath, directCapture, projectRoot, result, resultingPath, savedProject, sent, start }: {
  clearDraft: (projectRoot: string, pagePath: string) => void;
  current: DocumentBuffers;
  currentPath: string;
  projectRoot: string;
  result: NativeSaveResult;
  resultingPath: string;
  savedProject: FractalProject;
  sent: FractalNativeSectionEdits;
  start: DocumentBuffer;
  directCapture: boolean;
}) {
  const currentBuffer = current[currentPath] ?? current[resultingPath];
  if (!currentBuffer) return { buffers: current, dirty: false };
  const nextBuffer = nextDocumentBuffer(currentBuffer, start, result, savedProject, resultingPath, sent, directCapture);
  const next = { ...current };
  delete next[currentPath];
  next[resultingPath] = nextBuffer;
  if (!nextBuffer.dirty) {
    clearDraft(projectRoot, currentPath);
    if (resultingPath !== currentPath) clearDraft(projectRoot, resultingPath);
  }
  return { buffers: next, dirty: nextBuffer.dirty };
}

type SaveContext = PersistenceOptions & {
  clearDraft: (projectRoot: string, pagePath: string) => void;
  forceRequests: Set<string>;
  drainRequests: Set<string>;
  registerSavePath: (path: string) => void;
};

function captureSessionBuffer(context: SaveContext, buffer: DocumentBuffer, force: boolean) {
  const session = context.documentRegistry?.getByPath(buffer.path);
  if (!session || !buffer.nativeDocumentParts) return null;

  const sessionSnapshot = session.getSnapshot();
  if (!force && !buffer.dirty && sessionSnapshot.revision <= buffer.savedRevision) return null;

  const shouldEncodeBody = force || sessionSnapshot.bodyDirty || buffer.nativeEdits.content != null;
  const encoded = shouldEncodeBody ? captureAndEncodeDocument(session) : { bodyHtml: buffer.bodyHtml, capture: captureDocument(session) };
  const { capture } = encoded;
  if (capture.path !== buffer.path) throw new Error(`The captured document path changed while saving ${buffer.path}.`);
  if (capture.projectGeneration !== buffer.projectGeneration) throw new Error(`The captured document for ${buffer.path} belongs to another project session.`);
  if (capture.replacementGeneration < buffer.incarnation) throw new Error(`The captured document for ${buffer.path} belongs to an obsolete document incarnation.`);
  if (capture.revision < buffer.revision) throw new Error(`The captured document for ${buffer.path} is behind revision ${buffer.revision}.`);

  const nativeEdits = { ...buffer.nativeEdits };
  if (capture.title === buffer.nativeDocumentParts.title) delete nativeEdits.title;
  else nativeEdits.title = capture.title;
  if (encoded.bodyHtml === buffer.nativeDocumentParts.contentHtml) delete nativeEdits.content;
  else if (sessionSnapshot.bodyDirty) nativeEdits.content = encoded.bodyHtml;

  return {
    buffer: {
      ...buffer,
      bodyHtml: encoded.bodyHtml,
      dirty: true,
      nativeEdits,
      revision: capture.revision,
      title: capture.title
    } satisfies DocumentBuffer,
    directCapture: true
  };
}

function bufferForDocument(buffers: DocumentBuffers, documentId: string) {
  return Object.values(buffers).find((buffer) => buffer.documentId === documentId);
}

async function writeRecoveryDraftFromSession(
  buffersRef: MutableValue<DocumentBuffers>,
  documentRegistry: DocumentRegistry | undefined,
  projectRef: MutableValue<FractalProject>,
  documentId: string,
  targetRevision: number
): Promise<PageDraftWriteResult | null> {
  const buffer = bufferForDocument(buffersRef.current, documentId);
  if (!buffer || !documentRegistry) return null;
  const session = documentRegistry.getByPath(buffer.path);
  if (!session || !buffer.nativeDocumentParts) return null;

  const encoded = captureAndEncodeDocument(session);
  const capture = encoded.capture;
  if (capture.documentId !== session.documentId) {
    throw new Error(`The recovery capture for ${buffer.path} belongs to another session.`);
  }
  if (capture.projectGeneration !== buffer.projectGeneration || capture.projectGeneration !== documentRegistry.projectGeneration) {
    throw new Error(`The recovery capture for ${buffer.path} belongs to another project session.`);
  }
  if (capture.path !== buffer.path) {
    throw new Error(`The recovery capture path changed while saving ${buffer.path}.`);
  }
  if (capture.replacementGeneration < buffer.incarnation) {
    throw new Error(`The recovery capture for ${buffer.path} belongs to an obsolete document incarnation.`);
  }
  if (capture.revision < targetRevision) {
    throw new Error(`The recovery capture for ${buffer.path} is behind revision ${targetRevision}.`);
  }

  const latest = bufferForDocument(buffersRef.current, documentId);
  if (!latest || latest.path !== capture.path || latest.projectGeneration !== capture.projectGeneration) {
    throw new Error(`The recovery capture for ${buffer.path} became obsolete before it was written.`);
  }
  const source = writeEditablePage(latest.source, capture.title, encoded.bodyHtml, latest.hasTitleHeading);
  const baseSourceHash = latest.contentHash ?? latest.nativeDocumentParts?.sourceHash ?? "";
  return writePageDraftSource(projectRef.current.rootPath, capture.path, source, baseSourceHash, capture.revision);
}

type SavePassResult = {
  kind: "finished" | "retry";
  path: string;
  success: boolean;
};

async function publishSaveResult(context: SaveContext, currentPath: string, start: DocumentBuffer, result: NativeSaveResult, directCapture: boolean) {
  const savedProject = result.project;
  const sent = result.sent;
  const resultingPath = result.resultingPath;
  const receipts = result.receipts ?? [];
  const scope = mutationScope(receipts);
  if (receipts.length) {
    try {
      await reconcilePageDrafts(context.projectRef.current.rootPath, scope.mappings);
    } catch (error) {
      context.onDraftStorageError?.(errorMessage(error));
    }
  }
  let nextBufferDirty = false;
  if (resultingPath !== currentPath) context.registerSavePath(resultingPath);
  context.commitBuffers((current) => {
    const update = updateBufferAfterSave({
      clearDraft: context.clearDraft,
      current,
      currentPath,
      directCapture,
      projectRoot: context.projectRef.current.rootPath,
      result,
      resultingPath,
      savedProject,
      sent,
      start
    });
    nextBufferDirty = update.dirty;
    return update.buffers;
  });
  if (directCapture && result.kind === "saved" && sent.content != null) {
    context.documentRegistry?.getByPath(currentPath)?.acknowledgeBody(start.revision, start.incarnation);
  }

  const currentBuffer = context.buffersRef.current[currentPath] ?? context.buffersRef.current[resultingPath];
  const nextProject = mergeSavedProject(
    context.projectRef.current,
    savedProject,
    currentPath,
    resultingPath,
    currentBuffer?.source ?? start.source,
    result.kind === "saved" && !currentBuffer?.dirty
  );
  context.projectRef.current = nextProject;
  context.publishProject(nextProject);
  if (resultingPath !== currentPath) {
    context.documentRegistry?.renameByPath(currentPath, resultingPath);
    context.onDocumentPathChange(currentPath, resultingPath);
  }
  return { nextBufferDirty, resultingPath };
}

async function savePass(context: SaveContext, path: string, force: boolean): Promise<SavePassResult> {
  const beforeFlush = context.buffersRef.current[path];
  if (!beforeFlush) return { kind: "finished", path, success: true };
  let start = beforeFlush;
  let directCapture = false;
  try {
    const captured = captureSessionBuffer(context, beforeFlush, force);
    if (captured) {
      start = captured.buffer;
      directCapture = captured.directCapture;
    } else {
      const snapshot = await context.flushDocument?.(beforeFlush);
      if (context.flushDocument && beforeFlush.revision > beforeFlush.snapshotRevision && !snapshot) {
        throw new Error(`The editor for ${beforeFlush.path} is unavailable, so Amanite kept the document open.`);
      }
      start = context.buffersRef.current[path] ?? beforeFlush;
    }
  } catch (error) {
    context.commitBuffers((current) => {
      const buffer = current[path];
      return buffer
        ? { ...current, [path]: { ...buffer, operation: null, operationOutcome: "failed", error: errorMessage(error) } }
        : current;
    });
    return { kind: "finished", path, success: false };
  }
  if (!start.dirty && !force) return { kind: "finished", path, success: true };
  context.commitBuffers((current) => {
    const buffer = current[path];
    return buffer
      ? { ...current, [path]: { ...buffer, operation: "save", error: null } }
      : current;
  });

  try {
    const result = await saveNativeDocument(context.projectRef.current, start, force);
    const update = await publishSaveResult(context, path, start, result, directCapture);
    if (result.kind !== "saved") {
      return { kind: "finished", path: update.resultingPath, success: false };
    }
    return {
      kind: update.nextBufferDirty ? "retry" : "finished",
      path: update.resultingPath,
      success: true
    };
  } catch (error) {
    context.commitBuffers((current) => {
      const buffer = current[path];
      return buffer
        ? { ...current, [path]: { ...buffer, operation: null, error: errorMessage(error) } }
        : current;
    });
    return { kind: "finished", path, success: false };
  }
}

async function runSaveQueue(context: SaveContext, originalPath: string) {
  let currentPath = originalPath;
  while (true) {
    const force = context.forceRequests.delete(currentPath)
      || (currentPath !== originalPath && context.forceRequests.delete(originalPath));
    const pass = await savePass(context, currentPath, force);
    currentPath = pass.path;
    if (pass.kind === "retry" && (context.drainRequests.has(originalPath) || context.drainRequests.has(currentPath))) continue;
    if (pass.success) {
      context.forceRequests.delete(currentPath);
      return true;
    }
    if (context.forceRequests.has(currentPath) || context.forceRequests.has(originalPath)) continue;
    return false;
  }
}

export function createDocumentPersistence({ buffersRef, commitBuffers, documentRegistry, flushDocument, onDocumentPathChange, onDraftStorageError, projectRef, publishProject }: PersistenceOptions) {
  const savePromises = new Map<string, Promise<boolean>>();
  const forceRequests = new Set<string>();
  const drainRequests = new Set<string>();

  function releaseSavePromise(savePromise: Promise<boolean>) {
    for (const [path, queuedPromise] of savePromises) {
      if (queuedPromise === savePromise) {
        savePromises.delete(path);
        drainRequests.delete(path);
      }
    }
  }

  function clearDraft(projectRoot: string, pagePath: string) {
    void clearPageDraft(projectRoot, pagePath).catch((error) => {
      onDraftStorageError?.(errorMessage(error));
    });
  }

  function saveDocument(path: string, force = false, drain = true): Promise<boolean> {
    if (drain) drainRequests.add(path);
    if (force) forceRequests.add(path);
    const inFlight = savePromises.get(path);
    if (inFlight) return inFlight;

    const queue = { promise: null as Promise<boolean> | null };
    const registerSavePath = (queuedPath: string) => {
      if (!queue.promise) return;
      const existing = savePromises.get(queuedPath);
      if (existing && existing !== queue.promise) return;
      savePromises.set(queuedPath, queue.promise);
    };

    const savePromise = runSaveQueue({
      buffersRef,
      clearDraft,
      commitBuffers,
      documentRegistry,
      flushDocument,
      forceRequests,
      drainRequests,
      onDocumentPathChange,
      onDraftStorageError,
      projectRef,
      publishProject,
      registerSavePath
    }, path);

    queue.promise = savePromise;
    registerSavePath(path);
    void savePromise.then(() => {
      releaseSavePromise(savePromise);
    }, () => {
      releaseSavePromise(savePromise);
    });
    return savePromise;
  }

  async function saveAll() {
    while (true) {
      const dirtyPaths = Object.values(buffersRef.current)
        .filter((buffer) => buffer.dirty)
        .map((buffer) => buffer.path);
      if (!dirtyPaths.length) return true;
      for (const path of dirtyPaths) {
        if (!(await saveDocument(path))) return false;
      }
    }
  }

  async function savePaths(paths: Iterable<string>) {
    const requested = new Set(paths);
    while (true) {
      const dirtyPaths = Object.values(buffersRef.current)
        .filter((buffer) => buffer.dirty && requested.has(buffer.path))
        .map((buffer) => buffer.path);
      if (!dirtyPaths.length) return true;
      for (const path of dirtyPaths) {
        if (!(await saveDocument(path))) return false;
      }
    }
  }

  // Autosave commits one captured revision. Newer typing is scheduled by the
  // idle/max-lag timers, while explicit saves and close barriers drain the queue.
  const autosaveDocument = (path: string) => saveDocument(path, false, false);
  const writeRecoveryDraft: RecoveryDraftWriter = (documentId, targetRevision) => writeRecoveryDraftFromSession(
    buffersRef,
    documentRegistry,
    projectRef,
    documentId,
    targetRevision
  );
  return { autosaveDocument, saveAll, saveDocument, savePaths, writeRecoveryDraft };
}
