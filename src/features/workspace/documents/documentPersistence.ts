import { clearPageDraft } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalNativeDocumentParts, FractalNativeSection, FractalNativeSectionEdits, FractalProject } from "@/lib/fractal/types";
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
  onDocumentPathChange: (from: string, to: string) => void;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
};

const nativeSectionOrder: FractalNativeSection[] = ["title", "content", "style", "metadata", "headLinks"];

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
    case "headLinks": return parts.headLinksHash;
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
    case "headLinks": return fractalClient.setPageHeadLinks(project, value, expectedHash);
  }
}

type NativeSaveResult =
  | { kind: "saved"; project: FractalProject; sent: FractalNativeSectionEdits }
  | { kind: "conflict"; message: string };

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

  const sent: FractalNativeSectionEdits = {};
  for (const section of nativeSectionOrder) {
    const value = buffer.nativeEdits[section];
    if (value == null) continue;
    const result = await applySection(workingProject, section, value, sectionHash(parts, section));
    if (result.status === "conflict") return { kind: "conflict", message: result.message };
    sent[section] = value;
    workingProject = result.project;
    parts = workingProject.activePageNativeDocumentParts ?? parts;
  }
  return { kind: "saved", project: workingProject, sent };
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
      activePageIframes: savedProject.activePageIframes,
      activePageIframeBacklinks: savedProject.activePageIframeBacklinks,
      activePageContentHash: savedProject.activePageContentHash,
      activePageNativeDocumentParts: savedProject.activePageNativeDocumentParts ?? null
    } : {})
  };
}

export function createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange, projectRef, publishProject }: PersistenceOptions) {
  const savePromises = new Map<string, Promise<boolean>>();
  const forceRequests = new Set<string>();

  function saveDocument(path: string, force = false): Promise<boolean> {
    if (force) forceRequests.add(path);
    const inFlight = savePromises.get(path);
    if (inFlight) return inFlight;

    const savePromise = (async () => {
      while (true) {
        const start = buffersRef.current[path];
        const forceAttempt = forceRequests.delete(path);
        if (!start || (!start.dirty && !forceAttempt)) return true;

        commitBuffers((current) => {
          const buffer = current[path];
          return buffer
            ? { ...current, [path]: { ...buffer, operation: "save", error: null } }
            : current;
        });

        try {
          let savedProject: FractalProject;
          let sent: FractalNativeSectionEdits = {};
          if (start.kind === "native") {
            const result = await saveNativeDocument(projectRef.current, start, forceAttempt);
            if (result.kind === "conflict") {
              commitBuffers((current) => {
                const buffer = current[path];
                return buffer ? {
                  ...current,
                  [path]: {
                    ...buffer,
                    operation: null,
                    conflict: true,
                    error: "This page changed on disk. Reload it or replace the external version."
                  }
                } : current;
              });
              if (forceRequests.has(path)) continue;
              return false;
            }
            savedProject = result.project;
            sent = result.sent;
          } else {
            const snapshot = projectForBuffer(projectRef.current, start);
            if (!forceAttempt && !start.contentHash) {
              throw new Error(`Fractal did not provide a content hash for ${path}.`);
            }
            if (forceAttempt) {
              savedProject = await fractalClient.writeRawPage(snapshot, start.source);
            } else {
              const result: FractalConditionalWriteResult = await fractalClient.writeRawPageIfUnchanged(snapshot, start.source, start.contentHash!);
              if (result.status === "conflict") {
                commitBuffers((current) => {
                  const buffer = current[path];
                  return buffer ? {
                    ...current,
                    [path]: {
                      ...buffer,
                      operation: null,
                      conflict: true,
                      error: "This page changed on disk. Reload it or replace the external version."
                    }
                  } : current;
                });
                if (forceRequests.has(path)) continue;
                return false;
              }
              savedProject = result.project;
            }
          }

          const resultingPath = savedProject.activePagePath ?? path;
          commitBuffers((current) => {
            const currentBuffer = current[path];
            if (!currentBuffer) return current;
            const remainingEdits = { ...currentBuffer.nativeEdits };
            for (const section of Object.keys(sent) as FractalNativeSection[]) {
              if (remainingEdits[section] === sent[section]) delete remainingEdits[section];
            }
            const hasPendingNativeEdits = Object.keys(remainingEdits).length > 0;
            const hasNewerEdits = currentBuffer.revision !== start.revision;
            const savedPage = pageForProject(savedProject, resultingPath);
            const nextBuffer: DocumentBuffer = {
              ...currentBuffer,
              path: resultingPath,
              source: hasPendingNativeEdits || hasNewerEdits
                ? currentBuffer.source
                : savedProject.activePageSource ?? currentBuffer.source,
              links: savedPage?.links ?? savedProject.activePageLinks,
              backlinks: savedProject.activePageBacklinks,
              iframes: savedPage?.iframes ?? savedProject.activePageIframes,
              iframeBacklinks: savedProject.activePageIframeBacklinks,
              contentHash: savedPage?.contentHash ?? savedProject.activePageContentHash ?? currentBuffer.contentHash,
              nativeDocumentParts: savedProject.activePageNativeDocumentParts ?? currentBuffer.nativeDocumentParts,
              nativeEdits: currentBuffer.kind === "native" ? remainingEdits : {},
              conflict: false,
              dirty: currentBuffer.kind === "native" ? hasPendingNativeEdits : hasNewerEdits,
              error: null,
              operation: null
            };
            const next = { ...current };
            delete next[path];
            next[resultingPath] = nextBuffer;
            if (!nextBuffer.dirty) {
              clearPageDraft(projectRef.current.rootPath, path);
              if (resultingPath !== path) clearPageDraft(projectRef.current.rootPath, resultingPath);
            }
            return next;
          });

          forceRequests.delete(path);
          const currentBuffer = buffersRef.current[path] ?? buffersRef.current[resultingPath];
          const nextProject = mergeSavedProject(
            projectRef.current,
            savedProject,
            path,
            resultingPath,
            currentBuffer?.source ?? start.source,
            !currentBuffer?.dirty
          );
          projectRef.current = nextProject;
          if (resultingPath !== path || !currentBuffer?.dirty) publishProject(nextProject);
          if (resultingPath !== path) onDocumentPathChange(path, resultingPath);
          return true;
        } catch (error) {
          commitBuffers((current) => {
            const buffer = current[path];
            return buffer
              ? { ...current, [path]: { ...buffer, operation: null, error: errorMessage(error) } }
              : current;
          });
          return false;
        }
      }
    })();

    savePromises.set(path, savePromise);
    void savePromise.finally(() => {
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
