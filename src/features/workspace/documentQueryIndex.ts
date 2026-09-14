import type { DocumentCounts } from "@/features/editor/components/DocumentTools";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";
import { PageTitleIndex } from "@/lib/fractal/pageTitleIndex";
import type { FractalLink, FractalPage, FractalSearchResult } from "@/lib/fractal/types";

export type DocumentQueryFreshness = "saved" | "live";

export type LiveDocumentModel = {
  documentId: string;
  dirty: boolean;
  links: FractalLink[];
  model: EditorModelSnapshot;
  path: string;
  title: string;
};

export type DocumentQueryEntry = {
  counts: DocumentCounts;
  dirty: boolean;
  freshness: DocumentQueryFreshness;
  links: FractalLink[];
  outline: EditorModelSnapshot["outline"];
  path: string;
  revision: number;
  text: string;
  title: string;
};

function countsFromText(text: string): DocumentCounts {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return {
    characters: text.length,
    paragraphs: text ? 1 : 0,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 225)),
    words
  };
}

function snippet(text: string, query: string) {
  const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (match < 0) return text.slice(0, 180);
  const start = Math.max(0, match - 70);
  const end = Math.min(text.length, match + query.length + 110);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function sameModel(left: LiveDocumentModel | undefined, right: LiveDocumentModel) {
  return Boolean(left
    && left.path === right.path
    && left.title === right.title
    && left.dirty === right.dirty
    && left.model.revision === right.model.revision
    && left.model.text === right.model.text
    && left.links === right.links);
}

export class DocumentQueryIndex {
  readonly titleIndex: PageTitleIndex;
  private catalogByPath = new Map<string, FractalPage>();
  private catalogOrder: string[] = [];
  private liveByDocumentId = new Map<string, LiveDocumentModel>();
  private liveByPath = new Map<string, LiveDocumentModel>();
  private _version = 0;

  constructor(pages: FractalPage[] = []) {
    this.titleIndex = new PageTitleIndex(pages);
    this.updateCatalog(pages);
  }

  get version() {
    return this._version;
  }

  updateCatalog(pages: FractalPage[]) {
    const changed = this.titleIndex.update(pages);
    this.catalogByPath = new Map(pages.map((page) => [page.path, page]));
    this.catalogOrder = pages.map((page) => page.path);
    if (changed) this._version += 1;
    return changed;
  }

  setLiveDocument(document: LiveDocumentModel) {
    const previous = this.liveByDocumentId.get(document.documentId);
    if (sameModel(previous, document)) return false;
    if (previous) this.liveByPath.delete(previous.path);
    this.liveByDocumentId.set(document.documentId, document);
    this.liveByPath.set(document.path, document);
    this.titleIndex.setLiveTitle(document.path, document.title);
    this._version += 1;
    return true;
  }

  removeLiveDocument(documentId: string) {
    const previous = this.liveByDocumentId.get(documentId);
    if (!previous) return false;
    this.liveByDocumentId.delete(documentId);
    this.liveByPath.delete(previous.path);
    this.titleIndex.setLiveTitle(previous.path, this.catalogByPath.get(previous.path)?.title ?? "");
    this._version += 1;
    return true;
  }

  syncLiveDocuments(documents: LiveDocumentModel[]) {
    const active = new Set(documents.map((document) => document.documentId));
    let changed = false;
    for (const document of documents) changed = this.setLiveDocument(document) || changed;
    for (const documentId of this.liveByDocumentId.keys()) {
      if (!active.has(documentId)) changed = this.removeLiveDocument(documentId) || changed;
    }
    return changed;
  }

  getDocument(path: string): DocumentQueryEntry | null {
    const live = this.liveByPath.get(path);
    if (live) {
      return {
        counts: live.model.counts,
        dirty: live.dirty,
        freshness: "live",
        links: live.links,
        outline: live.model.outline,
        path,
        revision: live.model.revision,
        text: live.model.text,
        title: live.title
      };
    }
    const page = this.catalogByPath.get(path);
    if (!page) return null;
    return {
      counts: countsFromText(page.text),
      dirty: false,
      freshness: "saved",
      links: page.links,
      outline: [],
      path,
      revision: 0,
      text: page.text,
      title: this.titleIndex.getTitle(path) ?? page.title?.trim() ?? path
    };
  }

  readText(path: string, offset = 0, limit = 30_000) {
    const document = this.getDocument(path);
    if (!document) return null;
    const content = document.text.slice(offset, offset + limit);
    return {
      ...document,
      content,
      nextOffset: offset + content.length < document.text.length ? offset + content.length : null,
      offset
    };
  }

  listDocuments() {
    return this.catalogOrder.map((path) => this.getDocument(path)).filter((document): document is DocumentQueryEntry => Boolean(document));
  }

  search(query: string, prefix = ""): FractalSearchResult[] {
    const needle = query.trim().toLocaleLowerCase();
    return this.listDocuments()
      .filter((document) => !prefix || document.path === prefix || document.path.startsWith(`${prefix}/`))
      .filter((document) => !needle || `${document.title} ${document.path} ${document.text}`.toLocaleLowerCase().includes(needle))
      .map((document) => ({
        freshness: document.freshness,
        path: document.path,
        revision: document.revision,
        snippet: snippet(document.text, query.trim()),
        title: document.title
      }))
      .slice(0, 20);
  }

  matchingPages(query: string, excludedPath: string, limit = 8) {
    return this.titleIndex.matchingPages(query, excludedPath, limit);
  }
}
