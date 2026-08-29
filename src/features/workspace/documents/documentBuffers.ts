import type { FractalLoadedPage, FractalProject } from "@/lib/fractal/types";

export type DocumentBuffer = {
  path: string;
  source: string;
  links: FractalProject["activePageLinks"];
  backlinks: FractalProject["activePageBacklinks"];
  iframes: FractalProject["activePageIframes"];
  iframeBacklinks: FractalProject["activePageIframeBacklinks"];
  contentHash: string | null;
  dirty: boolean;
  revision: number;
  operation: "load" | "save" | null;
  error: string | null;
  conflict: boolean;
};

export type DocumentBuffers = Record<string, DocumentBuffer>;
export type BufferUpdater = (current: DocumentBuffers) => DocumentBuffers;

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function bufferFromProject(
  project: FractalProject,
  source = project.activePageSource ?? "",
  dirty = false
): DocumentBuffer | null {
  if (!project.activePagePath || project.activePageSource == null) return null;
  return {
    path: project.activePagePath,
    source,
    links: project.activePageLinks,
    backlinks: project.activePageBacklinks,
    iframes: project.activePageIframes,
    iframeBacklinks: project.activePageIframeBacklinks,
    contentHash: project.activePageContentHash ?? null,
    dirty,
    revision: dirty ? 1 : 0,
    operation: null,
    error: null,
    conflict: false
  };
}

export function bufferFromLoadedPage(loaded: FractalLoadedPage, source = loaded.source, dirty = false): DocumentBuffer {
  return {
    path: loaded.path,
    source,
    links: loaded.links,
    backlinks: loaded.backlinks,
    iframes: loaded.iframes,
    iframeBacklinks: loaded.iframeBacklinks,
    contentHash: loaded.contentHash,
    dirty,
    revision: dirty ? 1 : 0,
    operation: null,
    error: null,
    conflict: false
  };
}

export function projectForBuffer(project: FractalProject, buffer: DocumentBuffer): FractalProject {
  return {
    ...project,
    activePagePath: buffer.path,
    activePageSource: buffer.source,
    activePageLinks: buffer.links,
    activePageBacklinks: buffer.backlinks,
    activePageIframes: buffer.iframes,
    activePageIframeBacklinks: buffer.iframeBacklinks,
    activePageContentHash: buffer.contentHash
  };
}
