import { createLexicalComposerContext, type LexicalComposerContextType } from "@lexical/react/LexicalComposerContext";
import { createEmptyHistoryState, registerHistory, type HistoryState } from "@lexical/history";
import { $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $getRoot, type EditorState, type EditorUpdateOptions, type LexicalEditor } from "lexical";
import { createAmaniteEditor } from "@/features/editor/components/editorConfig";
import { AMANITE_DERIVED_LINK_TAG, AMANITE_HTML_LOAD_TAG } from "@/features/editor/components/editorHtml";
import { editorLexicalTheme } from "@/features/editor/components/editorLexicalTheme";

declare const documentIdBrand: unique symbol;

export type DocumentId = string & { readonly [documentIdBrand]: "DocumentId" };

export type DocumentSeed = {
  bodyHtml: string;
  title: string;
  initialRevision?: number;
  initialReplacementGeneration?: number;
};

export type DocumentSessionSnapshot = Readonly<{
  documentId: DocumentId;
  projectGeneration: number;
  path: string;
  title: string;
  revision: number;
  replacementGeneration: number;
  initialized: boolean;
  editable: boolean;
  disposed: boolean;
}>;

export type DocumentCapture = Readonly<{
  documentId: DocumentId;
  projectGeneration: number;
  path: string;
  title: string;
  revision: number;
  replacementGeneration: number;
  editorState: EditorState;
}>;

export type DocumentSessionEvent = Readonly<{
  kind: "body" | "title" | "replacement" | "path" | "editable";
  documentId: DocumentId;
  projectGeneration: number;
  path: string;
  title: string;
  revision: number;
  replacementGeneration: number;
  affectedNodeKeys: readonly string[];
}>;

export type DocumentSessionOptions = DocumentSeed & {
  documentId: DocumentId;
  projectGeneration: number;
  path: string;
};

type DocumentListener = (event: DocumentSessionEvent) => void;

let nextDocumentId = 1;

function createOpaqueDocumentId(): DocumentId {
  const id = `amanite-document-${nextDocumentId}`;
  nextDocumentId += 1;
  return id as DocumentId;
}

function requirePath(path: string) {
  if (!path.trim()) throw new Error("A document path is required.");
  return path;
}

function importBodyHtml(editor: LexicalEditor, bodyHtml: string) {
  const parsed = new DOMParser().parseFromString(bodyHtml || "<p></p>", "text/html");
  const nodes = $generateNodesFromDOM(editor, parsed.body);
  const root = $getRoot();
  root.clear();
  if (nodes.length) root.append(...nodes);
  else root.append($createParagraphNode());
}

export class DocumentSession {
  readonly documentId: DocumentId;
  readonly projectGeneration: number;
  readonly editor: LexicalEditor;
  readonly context: LexicalComposerContextType;
  readonly historyState: HistoryState;

  private path: string;
  private title: string;
  private revision: number;
  private replacementGeneration: number;
  private initialized = false;
  private editable = true;
  private disposed = false;
  private listeners = new Set<DocumentListener>();
  private unregisterUpdate: () => void;
  private unregisterHistory: () => void;

  constructor(options: DocumentSessionOptions) {
    this.documentId = options.documentId;
    this.projectGeneration = options.projectGeneration;
    this.path = requirePath(options.path);
    this.title = options.title;
    this.revision = options.initialRevision ?? 0;
    this.replacementGeneration = options.initialReplacementGeneration ?? 1;
    this.editor = createAmaniteEditor(`amanite-${this.documentId}`);
    this.context = createLexicalComposerContext(null, editorLexicalTheme);
    this.historyState = createEmptyHistoryState();
    this.unregisterUpdate = this.editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, tags }) => {
      if (this.disposed || tags.has(AMANITE_HTML_LOAD_TAG) || tags.has(AMANITE_DERIVED_LINK_TAG)
        || (!dirtyElements.size && !dirtyLeaves.size)) return;
      this.revision += 1;
      this.emit("body", [
        ...dirtyElements.keys(),
        ...dirtyLeaves.keys()
      ]);
    });

    this.editor.update(() => importBodyHtml(this.editor, options.bodyHtml), {
      discrete: true,
      tag: AMANITE_HTML_LOAD_TAG
    });
    this.unregisterHistory = registerHistory(this.editor, this.historyState, 1000);
    this.initialized = true;
  }

  getSnapshot(): DocumentSessionSnapshot {
    return {
      documentId: this.documentId,
      projectGeneration: this.projectGeneration,
      path: this.path,
      title: this.title,
      revision: this.revision,
      replacementGeneration: this.replacementGeneration,
      initialized: this.initialized,
      editable: this.editable,
      disposed: this.disposed
    };
  }

  capture(): DocumentCapture {
    this.assertOpen();
    return {
      documentId: this.documentId,
      projectGeneration: this.projectGeneration,
      path: this.path,
      title: this.title,
      revision: this.revision,
      replacementGeneration: this.replacementGeneration,
      editorState: this.editor.getEditorState()
    };
  }

  subscribe(listener: DocumentListener) {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(callback: () => void, options?: EditorUpdateOptions) {
    this.assertOpen();
    this.editor.update(callback, options);
  }

  setTitle(title: string) {
    this.assertOpen();
    if (this.title === title) return this.revision;
    this.title = title;
    this.revision += 1;
    this.emit("title");
    return this.revision;
  }

  setEditable(editable: boolean) {
    this.assertOpen();
    if (this.editable === editable) return;
    this.editable = editable;
    this.editor.setEditable(editable);
    this.emit("editable");
  }

  renamePath(path: string) {
    this.assertOpen();
    const nextPath = requirePath(path);
    if (this.path === nextPath) return;
    this.path = nextPath;
    this.emit("path");
  }

  replaceBodyHtml(bodyHtml: string, replacementGeneration?: number) {
    this.assertOpen();
    this.editor.update(() => importBodyHtml(this.editor, bodyHtml), {
      discrete: true,
      tag: AMANITE_HTML_LOAD_TAG
    });
    this.replacementGeneration = Math.max(this.replacementGeneration + 1, replacementGeneration ?? 0);
    this.revision += 1;
    this.resetHistory();
    this.emit("replacement");
    return this.replacementGeneration;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterHistory();
    this.unregisterUpdate();
    this.editor.setRootElement(null);
    this.resetHistory();
    this.listeners.clear();
  }

  private resetHistory() {
    this.historyState.current = null;
    this.historyState.undoStack = [];
    this.historyState.redoStack = [];
  }

  private emit(kind: DocumentSessionEvent["kind"], affectedNodeKeys: readonly string[] = []) {
    const event = {
      kind,
      documentId: this.documentId,
      projectGeneration: this.projectGeneration,
      path: this.path,
      title: this.title,
      revision: this.revision,
      replacementGeneration: this.replacementGeneration,
      affectedNodeKeys: [...new Set(affectedNodeKeys)]
    } satisfies DocumentSessionEvent;
    for (const listener of this.listeners) listener(event);
  }

  private assertOpen() {
    if (this.disposed) throw new Error(`Document ${this.documentId} has been disposed.`);
  }
}

export type DocumentLoader = () => DocumentSeed | Promise<DocumentSeed>;

export type OpenDocumentResult = Readonly<{
  session: DocumentSession;
  reused: boolean;
}>;

export type DocumentRegistryOptions = {
  projectGeneration: number;
  documentIdFactory?: () => DocumentId;
};

export class DocumentRegistry {
  readonly projectGeneration: number;

  private readonly documentIdFactory: () => DocumentId;
  private readonly sessionsById = new Map<DocumentId, DocumentSession>();
  private readonly paths = new Map<string, DocumentId>();
  private readonly opening = new Map<string, Promise<DocumentSession>>();
  private disposed = false;

  constructor(options: DocumentRegistryOptions) {
    this.projectGeneration = options.projectGeneration;
    this.documentIdFactory = options.documentIdFactory ?? createOpaqueDocumentId;
  }

  get size() {
    return this.sessionsById.size;
  }

  getById(documentId: DocumentId) {
    return this.sessionsById.get(documentId);
  }

  getByPath(path: string) {
    const documentId = this.paths.get(path);
    return documentId ? this.sessionsById.get(documentId) : undefined;
  }

  sessions() {
    return [...this.sessionsById.values()];
  }

  openLoaded(path: string, seed: DocumentSeed): OpenDocumentResult {
    this.assertOpen();
    const requestedPath = requirePath(path);
    const existing = this.getByPath(requestedPath);
    if (existing) return { session: existing, reused: true };

    const session = new DocumentSession({
      ...seed,
      documentId: this.documentIdFactory(),
      projectGeneration: this.projectGeneration,
      path: requestedPath
    });
    this.sessionsById.set(session.documentId, session);
    this.paths.set(requestedPath, session.documentId);
    return { session, reused: false };
  }

  open(path: string, load: DocumentLoader): Promise<OpenDocumentResult> {
    this.assertOpen();
    const requestedPath = requirePath(path);
    const existing = this.getByPath(requestedPath);
    if (existing) return Promise.resolve({ session: existing, reused: true });

    const pending = this.opening.get(requestedPath);
    if (pending) return pending.then((session) => ({ session, reused: true }));

    const pendingSession = (async () => {
      const seed = await load();
      this.assertOpen();
      const concurrent = this.getByPath(requestedPath);
      if (concurrent) return concurrent;
      return this.openLoaded(requestedPath, seed).session;
    })();
    this.opening.set(requestedPath, pendingSession);

    return pendingSession
      .then((session) => ({ session, reused: false }))
      .finally(() => this.opening.delete(requestedPath));
  }

  rename(documentId: DocumentId, path: string) {
    this.assertOpen();
    const session = this.requireSession(documentId);
    const nextPath = requirePath(path);
    const existingId = this.paths.get(nextPath);
    if (existingId && existingId !== documentId) {
      throw new Error(`Document path is already open: ${nextPath}`);
    }
    const previousPath = session.getSnapshot().path;
    if (previousPath === nextPath) return session;
    this.paths.delete(previousPath);
    this.paths.set(nextPath, documentId);
    session.renamePath(nextPath);
    return session;
  }

  renameByPath(from: string, to: string) {
    const session = this.getByPath(from);
    return session ? this.rename(session.documentId, to) : undefined;
  }

  close(documentId: DocumentId) {
    const session = this.sessionsById.get(documentId);
    if (!session) return false;
    this.sessionsById.delete(documentId);
    const path = session.getSnapshot().path;
    if (this.paths.get(path) === documentId) this.paths.delete(path);
    session.dispose();
    return true;
  }

  closeByPath(path: string) {
    const session = this.getByPath(path);
    return session ? this.close(session.documentId) : false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const session of this.sessionsById.values()) session.dispose();
    this.sessionsById.clear();
    this.paths.clear();
    this.opening.clear();
  }

  private requireSession(documentId: DocumentId) {
    const session = this.sessionsById.get(documentId);
    if (!session) throw new Error(`Unknown document: ${documentId}`);
    return session;
  }

  private assertOpen() {
    if (this.disposed) throw new Error("Document registry has been disposed.");
  }
}
