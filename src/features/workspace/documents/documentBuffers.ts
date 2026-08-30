import type { FractalLoadedPage, FractalNativeDocumentParts, FractalNativeSectionEdits, FractalPageKind, FractalProject } from "@/lib/fractal/types";

export type DocumentBuffer = {
  path: string;
  kind: FractalPageKind;
  source: string;
  links: FractalProject["activePageLinks"];
  backlinks: FractalProject["activePageBacklinks"];
  iframes: FractalProject["activePageIframes"];
  iframeBacklinks: FractalProject["activePageIframeBacklinks"];
  contentHash: string | null;
  nativeDocumentParts: FractalNativeDocumentParts | null;
  nativeEdits: FractalNativeSectionEdits;
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

function nativeSectionValues(source: string): FractalNativeSectionEdits {
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = document.body.querySelector("main[data-fractal-document]");
  const title = document.title.trim();
  const contentRoot = root?.cloneNode(true) as HTMLElement | null;
  contentRoot?.querySelector(":scope > h1[data-fractal-title]")?.remove();
  return {
    title,
    content: contentRoot?.innerHTML ?? ""
  };
}

export function nativeEditsFromSource(source: string, parts: FractalNativeDocumentParts): FractalNativeSectionEdits {
  const values = nativeSectionValues(source);
  const edits: FractalNativeSectionEdits = {};
  if (values.title !== parts.title) edits.title = values.title;
  if (values.content !== parts.contentHtml) edits.content = values.content;
  return edits;
}

function nativePartsForProject(project: FractalProject) {
  return project.activePageNativeDocumentParts ?? null;
}

function nativeEditsForSource(source: string, parts: FractalNativeDocumentParts | null, dirty: boolean) {
  return dirty && parts ? nativeEditsFromSource(source, parts) : {};
}

export function bufferFromProject(
  project: FractalProject,
  source = project.activePageSource ?? "",
  dirty = false
): DocumentBuffer | null {
  if (!project.activePagePath || project.activePageSource == null) return null;
  return {
    path: project.activePagePath,
    kind: project.pages.find((page) => page.path === project.activePagePath)?.kind ?? "raw",
    source,
    links: project.activePageLinks,
    backlinks: project.activePageBacklinks,
    iframes: project.activePageIframes,
    iframeBacklinks: project.activePageIframeBacklinks,
    contentHash: project.activePageContentHash ?? null,
    nativeDocumentParts: nativePartsForProject(project),
    nativeEdits: nativeEditsForSource(source, nativePartsForProject(project), dirty),
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
    kind: loaded.kind,
    source,
    links: loaded.links,
    backlinks: loaded.backlinks,
    iframes: loaded.iframes,
    iframeBacklinks: loaded.iframeBacklinks,
    contentHash: loaded.contentHash,
    nativeDocumentParts: loaded.nativeDocumentParts ?? null,
    nativeEdits: nativeEditsForSource(source, loaded.nativeDocumentParts ?? null, dirty),
    dirty,
    revision: dirty ? 1 : 0,
    operation: null,
    error: null,
    conflict: false
  };
}
