import { clearPageDraft, reconcilePageDrafts, writePageDraftSource, type PageDraftWriteResult } from "@/app/pageDrafts";
import { fractalClient, isFractalCommandError } from "@/lib/fractal/client";
import type { FractalLoadedPage, FractalNativeDocumentParts, FractalNativeSection, FractalNativeSectionEdits, FractalProject } from "@/lib/fractal/types";
import { mapPagePath, mutationScope, reconcileMutationResult, reconcileProjectSnapshot } from "@/lib/fractal/reconcile";
import type { FractalMutationReceipt } from "@/lib/fractal/types";
import { settleEditorComposition, type EditorSnapshot } from "@/features/editor/components/editorFlush";
import { readEditablePage, writeEditablePage } from "@/features/editor/components/pageSource";
import {
  errorMessage,
  isProtectedDocument,
  type BufferUpdater,
  type DocumentBuffer,
  type DocumentBuffers
} from "./documentBuffers";
import { captureAndEncodeDocument, captureDocument } from "./documentEncoding";
import { DocumentRecoveryCoordinator, type RecoveryDraftWriter as SessionRecoveryDraftWriter } from "./documentRecovery";
import { compareEditableLinkRewrites } from "./documentStructuralCommands";
import type { DocumentRegistry } from "./documentRuntime";

type MutableValue<T> = { current: T };

type PersistenceOptions = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  documentRegistry?: DocumentRegistry;
  flushDocument?: (buffer: DocumentBuffer) => EditorSnapshot | null | void | Promise<EditorSnapshot | null | void>;
  onDraftConfirmed?: (documentId: string, revision: number) => void;
  onDraftError?: (documentId: string, message: string) => void;
  onDocumentPathChange: (from: string, to: string) => void;
  onDraftStorageError?: (message: string) => void;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
  onStructuralOperationChange?: (operation: "title" | null) => void;
  onLiveDocumentInvalidated?: (documentId: string) => void;
};

export type DocumentPersistenceBaseline = Readonly<{
  hasTitleHeading: boolean;
  nativeDocumentParts: FractalNativeDocumentParts | null;
  source: string;
}>;

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
  force: boolean,
  skipTitle = false
): Promise<NativeSaveResult> {
  let workingProject = projectForBuffer(project, buffer);
  let parts = buffer.nativeDocumentParts;
  let hasFreshProject = false;
  if (force) {
    const latest = await fractalClient.readPage(workingProject, buffer.path);
    parts = latest.nativeDocumentParts ?? null;
    if (parts) {
      hasFreshProject = true;
      const page = workingProject.pages.find((candidate) => candidate.path === buffer.path);
      workingProject = {
        ...workingProject,
        activePagePath: latest.path,
        activePageSource: latest.source,
        activePageLinks: latest.links,
        activePageBacklinks: latest.backlinks,
        activePageContentHash: latest.contentHash,
        activePageNativeDocumentParts: parts,
        pages: page
          ? workingProject.pages.map((candidate) => candidate.path === buffer.path
            ? { ...candidate, contentHash: latest.contentHash, title: parts?.title ?? candidate.title }
            : candidate)
          : workingProject.pages
      };
    }
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
  const projectAfterCommittedSections = () => Object.keys(sent).length || hasFreshProject ? workingProject : project;
  for (const section of nativeSectionOrder) {
    if (skipTitle && section === "title") continue;
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
  resultingPath: string
) {
  const wasActive = currentProject.activePagePath === path;
  const reconciled = reconcileProjectSnapshot(currentProject, savedProject);
  return {
    ...reconciled,
    ...(wasActive ? {
      activePagePath: resultingPath,
      activePageSource: savedProject.activePageSource ?? currentProject.activePageSource,
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
  const editsAtCapture = directCapture && !hasNewerEdits ? start.nativeEdits : currentBuffer.nativeEdits;
  const remainingEdits = pendingNativeEdits(editsAtCapture, sent, directCapture && !hasNewerEdits);
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
    path: resultingPath,
    revision: directCapture ? Math.max(currentBuffer.revision, start.revision) : currentBuffer.revision,
    links: savedProject.activePageLinks,
    backlinks: savedProject.activePageBacklinks,
    contentHash: fullyAcknowledged
      ? savedPage?.contentHash ?? savedProject.activePageContentHash ?? currentBuffer.contentHash
      : currentBuffer.contentHash,
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
  titleRequests: Set<string>;
  registerSavePath: (path: string) => void;
  syncRecovery: () => void;
  baselineFor: (path: string) => DocumentPersistenceBaseline | undefined;
  updateBaseline: (path: string, baseline: DocumentPersistenceBaseline) => void;
  renameBaseline: (from: string, to: string) => void;
  waitForStructuralOperation: () => Promise<void>;
  runStructuralTitle?: (path: string, force: boolean, registerSavePath?: (path: string) => void) => Promise<boolean>;
  reconcileStructuralReceipt?: (args: {
    resultingPath: string;
    savedProject: FractalProject;
    receipts: readonly FractalMutationReceipt[];
  }) => Promise<boolean>;
};

function captureSessionBuffer(context: SaveContext, buffer: DocumentBuffer, force: boolean) {
  const session = context.documentRegistry?.getByPath(buffer.path);
  const nativeDocumentParts = buffer.nativeDocumentParts;
  if (!session || isProtectedDocument(buffer) || !nativeDocumentParts) return null;

  const sessionSnapshot = session.getSnapshot();
  if (!force && !buffer.dirty && sessionSnapshot.revision <= buffer.savedRevision) return null;

  const shouldEncodeBody = force || sessionSnapshot.bodyDirty || buffer.nativeEdits.content != null;
  const encoded = shouldEncodeBody ? captureAndEncodeDocument(session) : null;
  const capture = encoded?.capture ?? captureDocument(session);
  if (capture.path !== buffer.path) throw new Error(`The captured document path changed while saving ${buffer.path}.`);
  if (capture.projectGeneration !== buffer.projectGeneration) throw new Error(`The captured document for ${buffer.path} belongs to another project session.`);
  if (capture.replacementGeneration < buffer.incarnation) throw new Error(`The captured document for ${buffer.path} belongs to an obsolete document incarnation.`);
  if (capture.revision < buffer.revision) throw new Error(`The captured document for ${buffer.path} is behind revision ${buffer.revision}.`);

  const nativeEdits = { ...buffer.nativeEdits };
  if (force) {
    // Replace-disk is an explicit local-wins command. Rebuild every native
    // section from the accepted local baseline, not only the sections that
    // differed before an external edit was observed. Otherwise a clean local
    // document can "replace" the disk and leave the external content there.
    nativeEdits.title = capture.title;
    nativeEdits.content = encoded?.bodyHtml ?? nativeDocumentParts.contentHtml;
    nativeEdits.style ??= nativeDocumentParts.styleCss;
    nativeEdits.metadata ??= nativeDocumentParts.metadataHtml;
  } else {
    if (capture.title === nativeDocumentParts.title) delete nativeEdits.title;
    else nativeEdits.title = capture.title;
    if (encoded) {
      if (encoded.bodyHtml === nativeDocumentParts.contentHtml) delete nativeEdits.content;
      else nativeEdits.content = encoded.bodyHtml;
    }
  }
  return {
    buffer: {
      ...buffer,
      dirty: true,
      nativeEdits,
      revision: capture.revision
    } satisfies DocumentBuffer,
    directCapture: true
  };
}

function bufferForDocument(buffers: DocumentBuffers, documentId: string) {
  return Object.values(buffers).find((buffer) => buffer.documentId === documentId);
}

async function writeRecoveryDraftForSession(
  buffersRef: MutableValue<DocumentBuffers>,
  documentRegistry: DocumentRegistry,
  projectRef: MutableValue<FractalProject>,
  baselineFor: (path: string) => DocumentPersistenceBaseline | undefined,
  session: Parameters<SessionRecoveryDraftWriter>[0],
  targetRevision: number
): Promise<PageDraftWriteResult | null> {
  if (documentRegistry.getById(session.documentId) !== session) return null;
  const sessionSnapshot = session.getSnapshot();
  const buffer = buffersRef.current[sessionSnapshot.path];
  if (!buffer) return null;
  if (buffer.operation === "load") return null;

  const latest = buffersRef.current[sessionSnapshot.path];
  if (!latest || latest.path !== sessionSnapshot.path || latest.projectGeneration !== sessionSnapshot.projectGeneration) {
    throw new Error(`The recovery capture for ${sessionSnapshot.path} became obsolete before it was written.`);
  }

  // Fractal-protected documents cannot be safely round-tripped through the
  // rich editor. Their recovery record keeps the exact retained source.
  // The session still supplies the identity and revision barrier, but it must
  // not normalize markup that Amanite has promised to leave untouched.
  if (isProtectedDocument(buffer)) {
    if (sessionSnapshot.revision < targetRevision) {
      throw new Error(`The recovery capture for ${buffer.path} is behind revision ${targetRevision}.`);
    }
    const source = latest.protectedSource ?? baselineFor(latest.path)?.source;
    if (source == null) throw new Error(`The protected recovery source for ${latest.path} is unavailable.`);
    const baseSourceHash = latest.contentHash ?? "";
    return writePageDraftSource(projectRef.current.rootPath, latest.path, source, baseSourceHash, sessionSnapshot.revision);
  }

  const baseline = baselineFor(buffer.path);
  if (!baseline) throw new Error(`The accepted native source for ${buffer.path} is unavailable.`);

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

  const current = buffersRef.current[capture.path];
  if (!current || current.path !== capture.path || current.projectGeneration !== capture.projectGeneration) {
    throw new Error(`The recovery capture for ${buffer.path} became obsolete before it was written.`);
  }
  const source = writeEditablePage(baseline.source, capture.title, encoded.bodyHtml, baseline.hasTitleHeading);
  const baseSourceHash = current.contentHash ?? current.nativeDocumentParts?.sourceHash ?? "";
  return writePageDraftSource(projectRef.current.rootPath, capture.path, source, baseSourceHash, capture.revision);
}

async function writeRecoveryDraftFromSession(
  buffersRef: MutableValue<DocumentBuffers>,
  documentRegistry: DocumentRegistry | undefined,
  projectRef: MutableValue<FractalProject>,
  baselineFor: (path: string) => DocumentPersistenceBaseline | undefined,
  documentId: string,
  targetRevision: number
): Promise<PageDraftWriteResult | null> {
  const buffer = bufferForDocument(buffersRef.current, documentId);
  if (!buffer || !documentRegistry) return null;
  const session = documentRegistry.getByPath(buffer.path);
  if (!session) return null;
  return writeRecoveryDraftForSession(buffersRef, documentRegistry, projectRef, baselineFor, session, targetRevision);
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

  const nextProject = mergeSavedProject(
    context.projectRef.current,
    savedProject,
    currentPath,
    resultingPath
  );
  if (resultingPath !== currentPath) context.renameBaseline(currentPath, resultingPath);
  if (savedProject.activePageSource != null && Object.keys(sent).length) {
    const acceptedSource = savedProject.activePageSource;
    const acceptedParts = savedProject.activePageNativeDocumentParts ?? start.nativeDocumentParts;
    context.updateBaseline(resultingPath, {
      hasTitleHeading: readEditablePage(acceptedSource).hasTitleHeading,
      nativeDocumentParts: acceptedParts,
      source: acceptedSource
    });
  }
  context.projectRef.current = nextProject;
  context.publishProject(nextProject);
  if (resultingPath !== currentPath) {
    context.documentRegistry?.renameByPath(currentPath, resultingPath);
    context.onDocumentPathChange(currentPath, resultingPath);
  }
  const structuralSuccess = context.reconcileStructuralReceipt && receipts.some((receipt) => receipt.operation === "set_page_title")
    ? await context.reconcileStructuralReceipt({ resultingPath, savedProject, receipts })
    : true;
  context.syncRecovery();
  return { nextBufferDirty, resultingPath, structuralSuccess };
}

async function savePass(context: SaveContext, path: string, force: boolean, skipTitle = false, barrierContext = false): Promise<SavePassResult> {
  if (!barrierContext) {
    await context.waitForStructuralOperation();
    const preflightBuffer = context.buffersRef.current[path];
    const session = context.documentRegistry?.getByPath(path);
    const titlePending = Boolean(session && preflightBuffer?.nativeDocumentParts
      && session.getSnapshot().title !== preflightBuffer.nativeDocumentParts.title);
    if (!skipTitle && titlePending && context.runStructuralTitle) {
      return { kind: "finished", path, success: await context.runStructuralTitle(path, force, context.registerSavePath) };
    }
  }
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
  if (skipTitle && !Object.keys(start.nativeEdits).some((section) => section !== "title")) {
    return { kind: "finished", path, success: true };
  }
  if (!start.dirty && !force) return { kind: "finished", path, success: true };
  context.commitBuffers((current) => {
    const buffer = current[path];
    return buffer
      ? { ...current, [path]: { ...buffer, operation: "save", error: null } }
      : current;
  });

  try {
    const result = await saveNativeDocument(context.projectRef.current, start, force, skipTitle);
    const update = await publishSaveResult(context, path, start, result, directCapture);
    if (result.kind !== "saved") {
      return { kind: "finished", path: update.resultingPath, success: false };
    }
    return {
      kind: update.structuralSuccess === false ? "finished" : update.nextBufferDirty ? "retry" : "finished",
      path: update.resultingPath,
      success: update.structuralSuccess
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

async function runSaveQueue(context: SaveContext, originalPath: string, skipTitle = false, barrierContext = false) {
  let currentPath = originalPath;
  let saveTitle = !skipTitle;
  while (true) {
    const force = context.forceRequests.delete(currentPath)
      || (currentPath !== originalPath && context.forceRequests.delete(originalPath));
    const pass = await savePass(context, currentPath, force, !saveTitle, barrierContext);
    currentPath = pass.path;
    if (pass.success && !saveTitle && context.titleRequests.delete(currentPath)) {
      saveTitle = true;
      continue;
    }
    if (pass.kind === "retry" && (context.drainRequests.has(originalPath) || context.drainRequests.has(currentPath))) continue;
    if (pass.success) {
      context.forceRequests.delete(currentPath);
      return true;
    }
    if (context.forceRequests.has(currentPath) || context.forceRequests.has(originalPath)) continue;
    return false;
  }
}

export function createDocumentPersistence({ buffersRef, commitBuffers, documentRegistry, flushDocument, onDraftConfirmed, onDraftError, onDocumentPathChange, onDraftStorageError, onLiveDocumentInvalidated, onStructuralOperationChange, projectRef, publishProject }: PersistenceOptions) {
  const savePromises = new Map<string, Promise<boolean>>();
  const forceRequests = new Set<string>();
  const drainRequests = new Set<string>();
  const baselines = new Map<string, DocumentPersistenceBaseline>();
  let structuralQueue = Promise.resolve();
  let activeStructuralOperation: Promise<boolean> | null = null;
  const titleRequests = new Set<string>();

  function baselineFor(path: string) {
    return baselines.get(path);
  }

  function registerBaseline(path: string, source: string, nativeDocumentParts: FractalNativeDocumentParts | null) {
    const editable = readEditablePage(source);
    baselines.set(path, {
      hasTitleHeading: editable.hasTitleHeading,
      nativeDocumentParts,
      source
    });
  }

  function updateBaseline(path: string, baseline: DocumentPersistenceBaseline) {
    baselines.set(path, baseline);
  }

  function renameBaseline(from: string, to: string) {
    const baseline = baselines.get(from);
    if (!baseline) return;
    baselines.delete(from);
    baselines.set(to, baseline);
  }

  function forgetBaseline(path: string) {
    baselines.delete(path);
  }

  function loadedPageFromProject(project: FractalProject, path: string): FractalLoadedPage | null {
    if (project.activePagePath !== path || project.activePageSource == null || project.activePageContentHash == null) return null;
    return {
      path,
      source: project.activePageSource,
      links: project.activePageLinks,
      backlinks: project.activePageBacklinks,
      contentHash: project.activePageContentHash,
      nativeDocumentParts: project.activePageNativeDocumentParts ?? null
    };
  }

  async function reconcileStructuralReceipt({ resultingPath, savedProject, receipts }: {
    resultingPath: string;
    savedProject: FractalProject;
    receipts: readonly FractalMutationReceipt[];
  }) {
    if (!documentRegistry) return true;
    const scope = mutationScope(receipts);
    const checkedPaths = new Set<string>();
    let success = true;

    for (const affectedPath of scope.affectedPages) {
      const mappedPath = mapPagePath(affectedPath, scope.mappings);
      const session = documentRegistry.getByPath(mappedPath) ?? documentRegistry.getByPath(affectedPath);
      if (!session) continue;
      const actualPath = session.getSnapshot().path;
      if (checkedPaths.has(actualPath)) continue;
      checkedPaths.add(actualPath);

      const buffer = buffersRef.current[actualPath];
      if (!buffer) continue;

      let loaded: FractalLoadedPage | null = actualPath === resultingPath
        ? loadedPageFromProject(savedProject, resultingPath)
        : null;
      try {
        loaded ??= await fractalClient.readPage(savedProject, actualPath);
      } catch (error) {
        success = false;
        const message = `A title move changed ${actualPath}, but Amanite could not inspect the new native source. Reload it or explicitly replace the local source. (${errorMessage(error)})`;
        commitBuffers((current) => current[actualPath]
          ? { ...current, [actualPath]: { ...current[actualPath], conflict: true, dirty: true, error: message, operation: null } }
          : current);
        continue;
      }

      if (!loaded?.nativeDocumentParts) {
        success = false;
        const message = `A title move changed ${actualPath}, but its native sections are unavailable. Reload it or explicitly replace the local source.`;
        commitBuffers((current) => current[actualPath]
          ? { ...current, [actualPath]: { ...current[actualPath], conflict: true, dirty: true, error: message, operation: null } }
          : current);
        continue;
      }
      const loadedParts = loaded.nativeDocumentParts;

      const beforeBody = captureAndEncodeDocument(session).bodyHtml;
      const afterBody = readEditablePage(loaded.source).bodyHtml;
      const comparison = compareEditableLinkRewrites(beforeBody, afterBody);
      let applied = comparison.kind !== "unsafe";
      let error: string | null = null;
      if (comparison.kind === "safe") {
        applied = session.applyExternalLinkRewrites(comparison.rewrites);
        if (applied) onLiveDocumentInvalidated?.(session.documentId);
        else error = "A title move changed an open document's link structure unexpectedly. Reload disk to accept the native source and reset its undo history, or use Replace disk to keep the local source.";
      } else if (comparison.kind === "unsafe") {
        error = `${comparison.reason} Reload disk to accept the native source and reset its undo history, or use Replace disk to keep the local source.`;
      }

      if (!applied) {
        success = false;
        error ??= "A title move could not be applied safely to this open document. Reload disk to accept the native source and reset its undo history, or use Replace disk to keep the local source.";
      }

      const nextNativeEdits = { ...buffer.nativeEdits };
      if (applied) {
        if (nextNativeEdits.content === beforeBody) delete nextNativeEdits.content;
      } else if (beforeBody !== afterBody) {
        nextNativeEdits.content = beforeBody;
      }
      if (session.getSnapshot().title !== loadedParts.title) nextNativeEdits.title = session.getSnapshot().title;
      else if (nextNativeEdits.title === loadedParts.title) delete nextNativeEdits.title;
      const hasPendingEdits = Object.keys(nextNativeEdits).length > 0;
      const nextRevision = session.getSnapshot().revision;
      const dirty = !applied || hasPendingEdits || nextRevision > buffer.savedRevision;
      commitBuffers((current) => {
        const currentBuffer = current[actualPath];
        if (!currentBuffer) return current;
        return {
          ...current,
          [actualPath]: {
            ...currentBuffer,
            contentHash: loaded!.contentHash,
            links: loaded!.links,
            backlinks: loaded!.backlinks,
            nativeDocumentParts: loadedParts,
            nativeEdits: nextNativeEdits,
            dirty,
            conflict: !applied,
            savedRevision: !dirty ? nextRevision : currentBuffer.savedRevision,
            operation: null,
            operationOutcome: applied ? "saved" : "conflict",
            error
          }
        };
      });
      updateBaseline(actualPath, {
        hasTitleHeading: readEditablePage(loaded.source).hasTitleHeading,
        nativeDocumentParts: loadedParts,
        source: loaded.source
      });
    }

    return success;
  }

  for (const buffer of Object.values(buffersRef.current)) {
    const source = buffer.protectedSource
      ?? (projectRef.current.activePagePath === buffer.path ? projectRef.current.activePageSource : null);
    if (source != null) registerBaseline(buffer.path, source, buffer.nativeDocumentParts);
  }

  const writeRecoveryDraftForOpenSession: SessionRecoveryDraftWriter = (session, targetRevision) => {
    if (!documentRegistry) return Promise.resolve(null);
    return writeRecoveryDraftForSession(buffersRef, documentRegistry, projectRef, baselineFor, session, targetRevision);
  };
  const recovery = documentRegistry ? new DocumentRecoveryCoordinator({
    autosave: (session) => {
      const snapshot = session.getSnapshot();
      return saveDocument(snapshot.path, false, false, snapshot.titleEditing);
    },
    buffersRef,
    documentRegistry,
    onDraftConfirmed,
    onDraftError,
    onStorageError: (message) => {
      if (message) onDraftStorageError?.(message);
    },
    writeDraft: writeRecoveryDraftForOpenSession
  }) : null;
  const syncRecovery = () => recovery?.sync();

  function releaseSavePromise(savePromise: Promise<boolean>) {
    for (const [path, queuedPromise] of savePromises) {
      if (queuedPromise === savePromise) {
        savePromises.delete(path);
        drainRequests.delete(path);
        titleRequests.delete(path);
      }
    }
  }

  function clearDraft(projectRoot: string, pagePath: string) {
    void clearPageDraft(projectRoot, pagePath).catch((error) => {
      onDraftStorageError?.(errorMessage(error));
    });
  }

  const waitForStructuralOperation = () => activeStructuralOperation?.then(() => undefined) ?? Promise.resolve();

  function makeContext(registerSavePath: (path: string) => void): SaveContext {
    return {
      buffersRef,
      clearDraft,
      commitBuffers,
      documentRegistry,
      flushDocument,
      forceRequests,
      drainRequests,
      titleRequests,
      onDocumentPathChange,
      onDraftStorageError,
      onLiveDocumentInvalidated,
      projectRef,
      publishProject,
      registerSavePath,
      syncRecovery,
      baselineFor,
      updateBaseline,
      renameBaseline,
      waitForStructuralOperation,
      runStructuralTitle: enqueueStructuralTitle,
      reconcileStructuralReceipt
    };
  }

  async function runBarrierPass(context: SaveContext, path: string, force: boolean, skipTitle: boolean) {
    let pass = await savePass(context, path, force, skipTitle, true);
    while (pass.kind === "retry") pass = await savePass(context, pass.path, false, skipTitle, true);
    return pass;
  }

  async function performStructuralTitle(path: string, force: boolean, registerSavePath?: (path: string) => void) {
    if (!documentRegistry) return false;
    const context = makeContext(registerSavePath ?? (() => undefined));
    const sessions = documentRegistry.sessions();
    const previousEditable = new Map(sessions.map((session) => [session.documentId, session.getSnapshot().editable]));
    try {
      await Promise.all(sessions
        .filter((session) => session.editor.isComposing())
        .map((session) => settleEditorComposition(session.editor.getRootElement())));
      for (const session of sessions) session.setEditable(false);

      const paths = [...new Set(sessions
        .map((session) => session.getSnapshot().path)
        .filter((sessionPath) => Boolean(buffersRef.current[sessionPath])))]
        .sort((left, right) => left.localeCompare(right));
      for (const sessionPath of paths) {
        const pass = await runBarrierPass(context, sessionPath, sessionPath === path ? force : false, true);
        if (!pass.success) return false;
      }

      const target = await runBarrierPass(context, path, false, false);
      return target.success;
    } catch (error) {
      commitBuffers((current) => {
        const buffer = current[path];
        return buffer ? { ...current, [path]: { ...buffer, operation: null, operationOutcome: "failed", error: errorMessage(error) } } : current;
      });
      return false;
    } finally {
      for (const session of sessions) {
        const editable = previousEditable.get(session.documentId);
        if (editable != null && documentRegistry.getById(session.documentId) === session) session.setEditable(editable);
      }
    }
  }

  function enqueueStructuralTitle(path: string, force: boolean, registerSavePath?: (path: string) => void) {
    onStructuralOperationChange?.("title");
    const run = structuralQueue.then(
      () => performStructuralTitle(path, force, registerSavePath),
      () => performStructuralTitle(path, force, registerSavePath)
    );
    structuralQueue = run.then(() => undefined, () => undefined);
    activeStructuralOperation = run;
    void run.then(() => {
      if (activeStructuralOperation === run) {
        activeStructuralOperation = null;
        onStructuralOperationChange?.(null);
      }
    }, () => {
      if (activeStructuralOperation === run) {
        activeStructuralOperation = null;
        onStructuralOperationChange?.(null);
      }
    });
    return run;
  }

  function saveDocument(path: string, force = false, drain = true, skipTitle = false): Promise<boolean> {
    if (drain) drainRequests.add(path);
    if (force) forceRequests.add(path);
    const inFlight = savePromises.get(path);
    if (inFlight) {
      if (!skipTitle) titleRequests.add(path);
      return inFlight;
    }

    const queue = { promise: null as Promise<boolean> | null };
    const registerSavePath = (queuedPath: string) => {
      if (!queue.promise) return;
      const existing = savePromises.get(queuedPath);
      if (existing && existing !== queue.promise) return;
      savePromises.set(queuedPath, queue.promise);
    };

    const context = makeContext(registerSavePath);
    context.titleRequests = titleRequests;
    const savePromise = runSaveQueue(context, path, skipTitle);

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
  const replaceExternal = (path: string) => saveDocument(path, true);
  const writeRecoveryDraft: RecoveryDraftWriter = (documentId, targetRevision) => writeRecoveryDraftFromSession(
    buffersRef,
    documentRegistry,
    projectRef,
    baselineFor,
    documentId,
    targetRevision
  );
  return {
    autosaveDocument,
    dispose: () => recovery?.dispose(),
    replaceExternal,
    saveAll,
    saveDocument,
    savePaths,
    setAutoSave: (enabled: boolean) => recovery?.setAutoSave(enabled),
    syncRecovery,
    writeRecoveryDraft,
    registerBaseline,
    renameBaseline,
    forgetBaseline,
    captureSource: async (path: string) => {
      const buffer = buffersRef.current[path];
      const baseline = baselineFor(path);
      if (!buffer || !baseline) return null;
      if (isProtectedDocument(buffer)) return buffer.protectedSource ?? baseline.source;
      const session = documentRegistry?.getByPath(path);
      if (!session) return null;
      const encoded = captureAndEncodeDocument(session);
      return writeEditablePage(baseline.source, encoded.capture.title, encoded.bodyHtml, baseline.hasTitleHeading);
    }
  };
}
