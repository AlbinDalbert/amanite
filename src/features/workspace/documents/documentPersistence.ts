import { clearPageDraft } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalNativeDocumentParts, FractalNativeSection, FractalNativeSectionEdits, FractalProject } from "@/lib/fractal/types";
import { mapPagePath, receiptMappings } from "@/lib/fractal/reconcile";
import {
  errorMessage,
  type BufferUpdater,
  type DocumentBuffer,
  type DocumentBuffers
} from "./documentBuffers";

type MutableValue<T> = { current: T };

type PersistenceOptions = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  flushDocument?: (path: string) => void;
  onDocumentPathChange: (from: string, to: string) => void;
  onDraftStorageError?: (message: string) => void;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
};

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

type NativeSaveResult =
  | { kind: "saved"; project: FractalProject; sent: FractalNativeSectionEdits; resultingPath: string }
  | { kind: "conflict" | "failed"; message: string; project: FractalProject; sent: FractalNativeSectionEdits; resultingPath: string };

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
  let resultingPath = buffer.path;
  const projectAfterCommittedSections = () => Object.keys(sent).length ? workingProject : project;
  for (const section of nativeSectionOrder) {
    const value = buffer.nativeEdits[section];
    if (value == null) continue;
    try {
      const result = await applySection(workingProject, section, value, sectionHash(expectedParts, section));
      if (result.status === "conflict") {
        return { kind: "conflict", message: result.error.message, project: projectAfterCommittedSections(), sent, resultingPath };
      }
      sent[section] = value;
      resultingPath = mapPagePath(resultingPath, receiptMappings(result.result.receipt));
      workingProject = result.result.project;
    } catch (error) {
      return { kind: "failed", message: errorMessage(error), project: projectAfterCommittedSections(), sent, resultingPath };
    }
  }
  return { kind: "saved", project: projectAfterCommittedSections(), sent, resultingPath };
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
  return {
    ...currentProject,
    pages: savedProject.pages,
    folders: savedProject.folders,
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

export function createDocumentPersistence({ buffersRef, commitBuffers, flushDocument, onDocumentPathChange, onDraftStorageError, projectRef, publishProject }: PersistenceOptions) {
  const savePromises = new Map<string, Promise<boolean>>();
  const forceRequests = new Set<string>();

  function clearDraft(projectRoot: string, pagePath: string) {
    void clearPageDraft(projectRoot, pagePath).catch((error) => {
      onDraftStorageError?.(errorMessage(error));
    });
  }

  function saveDocument(path: string, force = false): Promise<boolean> {
    if (force) forceRequests.add(path);
    const inFlight = savePromises.get(path);
    if (inFlight) return inFlight;

    const savePromise = (async () => {
      let currentPath = path;
      while (true) {
        // The editor export is debounced. Flush it before every queue pass so
        // a close or project mutation cannot save an older HTML snapshot.
        flushDocument?.(currentPath);
        const start = buffersRef.current[currentPath];
        const forceAttempt = forceRequests.delete(currentPath)
          || (currentPath !== path && forceRequests.delete(path));
        if (!start || (!start.dirty && !forceAttempt)) return true;

        commitBuffers((current) => {
          const buffer = current[currentPath];
          return buffer
            ? { ...current, [currentPath]: { ...buffer, operation: "save", error: null } }
            : current;
        });

        try {
          const result = await saveNativeDocument(projectRef.current, start, forceAttempt);
          const savedProject = result.project;
          const sent = result.sent;

          const resultingPath = result.resultingPath;
          let nextBufferDirty = false;
          commitBuffers((current) => {
            const currentBuffer = current[currentPath] ?? current[resultingPath];
            if (!currentBuffer) return current;
            const remainingEdits = { ...currentBuffer.nativeEdits };
            for (const section of Object.keys(sent) as FractalNativeSection[]) {
              if (remainingEdits[section] === sent[section]) delete remainingEdits[section];
            }
            const hasPendingNativeEdits = Object.keys(remainingEdits).length > 0;
            const hasNewerEdits = currentBuffer.revision !== start.revision;
            const failed = result.kind !== "saved";
            const savedPage = pageForProject(savedProject, resultingPath);
            const nextBuffer: DocumentBuffer = {
              ...currentBuffer,
              path: resultingPath,
              source: failed || hasPendingNativeEdits || hasNewerEdits
                ? currentBuffer.source
                : savedProject.activePageSource ?? currentBuffer.source,
              links: savedPage?.links ?? savedProject.activePageLinks,
              backlinks: savedProject.activePageBacklinks,
              contentHash: savedPage?.contentHash ?? savedProject.activePageContentHash ?? currentBuffer.contentHash,
              nativeDocumentParts: savedProject.activePageNativeDocumentParts ?? currentBuffer.nativeDocumentParts,
              nativeEdits: remainingEdits,
              conflict: result.kind === "conflict",
              dirty: failed || hasPendingNativeEdits || hasNewerEdits,
              error: result.kind === "conflict"
                ? "This page changed on disk. Reload it or replace the external version."
                : result.kind === "failed" ? result.message : null,
              operation: null
            };
            const next = { ...current };
            delete next[currentPath];
            next[resultingPath] = nextBuffer;
            nextBufferDirty = nextBuffer.dirty;
            if (!nextBuffer.dirty) {
              clearDraft(projectRef.current.rootPath, currentPath);
              if (resultingPath !== currentPath) clearDraft(projectRef.current.rootPath, resultingPath);
            }
            return next;
          });

          const currentBuffer = buffersRef.current[currentPath] ?? buffersRef.current[resultingPath];
          const nextProject = mergeSavedProject(
            projectRef.current,
            savedProject,
            currentPath,
            resultingPath,
            currentBuffer?.source ?? start.source,
            result.kind === "saved" && !currentBuffer?.dirty
          );
          projectRef.current = nextProject;
          publishProject(nextProject);
          if (resultingPath !== currentPath) {
            onDocumentPathChange(currentPath, resultingPath);
            currentPath = resultingPath;
          }

          if (result.kind !== "saved") {
            if (forceRequests.has(currentPath) || forceRequests.has(path)) continue;
            return false;
          }
          if (nextBufferDirty) continue;
          forceRequests.delete(currentPath);
          return true;
        } catch (error) {
          commitBuffers((current) => {
            const buffer = current[currentPath];
            return buffer
              ? { ...current, [currentPath]: { ...buffer, operation: null, error: errorMessage(error) } }
              : current;
          });
          return false;
        }
      }
    })();

    savePromises.set(path, savePromise);
    void savePromise.then(() => {
      if (savePromises.get(path) === savePromise) savePromises.delete(path);
    }, () => {
      if (savePromises.get(path) === savePromise) savePromises.delete(path);
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

  return { saveAll, saveDocument };
}
