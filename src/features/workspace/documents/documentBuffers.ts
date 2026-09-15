import type { FractalLoadedPage, FractalNativeDocumentParts, FractalNativeSectionEdits, FractalProject } from "@/lib/fractal/types";
import { readEditablePage } from "@/features/editor/components/pageSource";
import { documentIdentity } from "./documentSessions";

export type DocumentBuffer = {
  documentId: string;
  projectGeneration: number;
  incarnation: number;
  path: string;
  baseSource: string;
  source: string;
  title: string;
  bodyHtml: string;
  hasTitleHeading: boolean;
  links: FractalProject["activePageLinks"];
  backlinks: FractalProject["activePageBacklinks"];
  contentHash: string | null;
  nativeDocumentParts: FractalNativeDocumentParts | null;
  nativeEdits: FractalNativeSectionEdits;
  dirty: boolean;
  revision: number;
  snapshotRevision: number;
  savedRevision: number;
  draftedRevision: number;
  draftError: string | null;
  operation: "load" | "save" | null;
  operationOutcome?: "saved" | "conflict" | "partial" | "failed" | "mutation_committed" | "indeterminate" | "recovery_required";
  error: string | null;
  conflict: boolean;
  missing?: boolean;
};

export type DocumentBuffers = Record<string, DocumentBuffer>;
export type BufferUpdater = (current: DocumentBuffers) => DocumentBuffers;

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
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

function editableFields(source: string) {
  return readEditablePage(source);
}

type BufferIdentityOptions = {
  draftedRevision?: number;
  incarnation?: number;
  projectGeneration?: number;
  revision?: number;
};

function bufferIdentity(path: string, projectGeneration: number | undefined) {
  return documentIdentity(projectGeneration ?? 0, path);
}

export function bufferFromProject(
  project: FractalProject,
  source = project.activePageSource ?? "",
  dirty = false,
  options: BufferIdentityOptions = {}
): DocumentBuffer | null {
  if (!project.activePagePath || project.activePageSource == null) return null;
  const identity = bufferIdentity(project.activePagePath, options.projectGeneration ?? project.sessionGeneration);
  const editable = editableFields(source);
  const revision = dirty ? Math.max(1, options.revision ?? 1) : 0;
  return {
    documentId: identity.documentId,
    projectGeneration: identity.projectGeneration,
    incarnation: options.incarnation ?? 1,
    path: project.activePagePath,
    baseSource: project.activePageSource,
    source,
    title: editable.title,
    bodyHtml: editable.bodyHtml,
    hasTitleHeading: editable.hasTitleHeading,
    links: project.activePageLinks,
    backlinks: project.activePageBacklinks,
    contentHash: project.activePageContentHash ?? null,
    nativeDocumentParts: nativePartsForProject(project),
    nativeEdits: nativeEditsForSource(source, nativePartsForProject(project), dirty),
    dirty,
    revision,
    snapshotRevision: 0,
    savedRevision: 0,
    draftedRevision: dirty ? options.draftedRevision ?? 0 : 0,
    draftError: null,
    operation: null,
    error: null,
    conflict: false,
    missing: false
  };
}

export function bufferFromLoadedPage(loaded: FractalLoadedPage, source = loaded.source, dirty = false, options: BufferIdentityOptions = {}): DocumentBuffer {
  const identity = bufferIdentity(loaded.path, options.projectGeneration);
  const editable = editableFields(source);
  const revision = dirty ? Math.max(1, options.revision ?? 1) : 0;
  return {
    documentId: identity.documentId,
    projectGeneration: identity.projectGeneration,
    incarnation: options.incarnation ?? 1,
    path: loaded.path,
    baseSource: loaded.source,
    source,
    title: editable.title,
    bodyHtml: editable.bodyHtml,
    hasTitleHeading: editable.hasTitleHeading,
    links: loaded.links,
    backlinks: loaded.backlinks,
    contentHash: loaded.contentHash,
    nativeDocumentParts: loaded.nativeDocumentParts ?? null,
    nativeEdits: nativeEditsForSource(source, loaded.nativeDocumentParts ?? null, dirty),
    dirty,
    revision,
    snapshotRevision: 0,
    savedRevision: 0,
    draftedRevision: dirty ? options.draftedRevision ?? 0 : 0,
    draftError: null,
    operation: null,
    error: null,
    conflict: false,
    missing: false
  };
}
