import { clearPageDraft } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalProject } from "@/lib/fractal/types";
import type { FractalSavedPage } from "@/lib/fractal/types";
import {
  bufferFromProject,
  errorMessage,
  projectForBuffer,
  type BufferUpdater,
  type DocumentBuffers
} from "./documentBuffers";

type MutableValue<T> = { current: T };

type PersistenceOptions = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  projectRef: MutableValue<FractalProject>;
  publishProject: (project: FractalProject) => void;
};

export function createDocumentPersistence({ buffersRef, commitBuffers, projectRef, publishProject }: PersistenceOptions) {
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
          const snapshot = projectForBuffer(projectRef.current, start);
          if (!forceAttempt && !start.contentHash) {
            throw new Error(`Fractal did not provide a content hash for ${path}.`);
          }
          const forcedProject = forceAttempt
            ? await fractalClient.writePage(snapshot, start.source)
            : null;
          const writeResult = forcedProject
            ? { status: "saved" as const, savedPage: null }
            : await fractalClient.writePageIfUnchanged(snapshot, start.source, start.contentHash!);
          if (writeResult.status === "conflict") {
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

          const savedPage = writeResult.savedPage;
          const savedBuffer = forcedProject ? bufferFromProject(forcedProject) : null;
          if (forcedProject && !savedBuffer) throw new Error(`Fractal did not return ${path} after saving.`);
          if (!forcedProject && !savedPage) throw new Error(`Fractal did not return ${path} metadata after saving.`);
          const savedHash = savedBuffer?.contentHash ?? savedPage!.contentHash;

          commitBuffers((current) => {
            const currentBuffer = current[path];
            const hasNewerEdits = Boolean(currentBuffer && currentBuffer.revision !== start.revision);
            if (!currentBuffer) return current;
            const savedMetadata = savedPage ? {
              backlinks: savedPage.backlinks,
              contentHash: savedHash,
              iframeBacklinks: savedPage.iframeBacklinks,
              iframes: savedPage.page.iframes,
              links: savedPage.page.links
            } : savedBuffer!;
            const nextBuffer = {
              ...currentBuffer,
              ...savedMetadata,
              conflict: false,
              dirty: hasNewerEdits,
              error: null,
              operation: null,
              source: currentBuffer.source,
              revision: currentBuffer.revision
            };
            if (!hasNewerEdits) clearPageDraft(projectRef.current.rootPath, path);
            return { ...current, [path]: nextBuffer };
          });
          forceRequests.delete(path);
          if (forcedProject) {
            publishProject(forcedProject);
          } else {
            const currentProject = projectRef.current;
            const nextProject = {
              ...currentProject,
              pages: currentProject.pages.map((page) => page.path === path
                ? { ...savedPage!.page, contentHash: savedHash }
                : page),
              ...(currentProject.activePagePath === path ? {
                activePageBacklinks: savedPage!.backlinks,
                activePageContentHash: savedHash,
                activePageIframeBacklinks: savedPage!.iframeBacklinks,
                activePageIframes: savedPage!.page.iframes,
                activePageLinks: savedPage!.page.links
              } : {})
            };
            projectRef.current = nextProject;
          }
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
