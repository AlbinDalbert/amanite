import { createLexicalComposerContext, LexicalComposerContext, type LexicalComposerContextType } from "@lexical/react/LexicalComposerContext";
import { createEmptyHistoryState, type HistoryState } from "@lexical/history";
import { $createParagraphNode, $getRoot, $getSelection, type LexicalEditor } from "lexical";
import { createAmaniteEditor } from "./editorConfig";
import { AMANITE_DERIVED_LINK_TAG, AMANITE_HTML_LOAD_TAG } from "./editorHtml";
import { DerivedEditorModel, type EditorModelSnapshot } from "./editorModel";
import { editorLexicalTheme } from "./editorLexicalTheme";
import { useEffect, useMemo, type ReactNode } from "react";
import { measureDataflow } from "@/lib/dataflowTelemetry";

export type SharedDocumentEditorSession = {
  documentId: string;
  projectGeneration: number;
  editor: LexicalEditor;
  context: LexicalComposerContextType;
  historyState: HistoryState;
  initialized: boolean;
  needsSourceRefresh: boolean;
  getRevision: () => number;
  nextRevision: () => number;
  getIncarnation: () => number;
  replaceSource: () => number;
  getModel: (editorState?: import("lexical").EditorState, revision?: number) => EditorModelSnapshot;
  viewCount: number;
  getMirrorHtml: () => string;
  getMirrorText: () => string | null;
  acceptBodyHtml: (bodyHtml: string) => void;
  subscribe: (listener: () => void) => () => void;
  acquireView: () => void;
  releaseView: () => void;
  markInitialized: () => void;
  getViewScroll: (viewId: string) => number;
  setViewScroll: (viewId: string, scrollTop: number) => void;
  dispose: () => void;
};

type SessionRecord = SharedDocumentEditorSession & {
  mirrorHtml: string;
  mirrorText: string | null;
  revision: number;
  incarnation: number;
  listeners: Set<() => void>;
  viewScroll: Map<string, number>;
  unregisterUpdate: () => void;
  derivedModel: DerivedEditorModel;
  model: EditorModelSnapshot | null;
};

type DocumentSessionRecord = Omit<SessionRecord, "context" | "editor" | "unregisterUpdate"> & {
  attachments: Map<string, SessionRecord>;
  historyState: HistoryState;
};

export const AMANITE_VIEW_SYNC_TAG = "amanite-view-sync";
const sessions = new Map<string, DocumentSessionRecord>();

function emit(session: { listeners: Set<() => void> }) {
  for (const listener of session.listeners) listener();
}

export function acquireSharedDocumentEditor(documentId: string, projectGeneration: number, initialBodyHtml: string, viewId = "default", initialRevision = 0, initialIncarnation = 1): SharedDocumentEditorSession {
  let document = sessions.get(documentId);
  if (!document) {
    document = {
    documentId,
    projectGeneration,
    historyState: createEmptyHistoryState(),
    initialized: false,
    needsSourceRefresh: false,
    revision: initialRevision,
    incarnation: initialIncarnation,
    derivedModel: new DerivedEditorModel(),
    model: null,
    viewCount: 0,
    mirrorHtml: initialBodyHtml || "<p></p>",
    mirrorText: null,
    listeners: new Set<() => void>(),
    viewScroll: new Map<string, number>(),
    attachments: new Map<string, SessionRecord>(),
    getMirrorHtml() { return document!.mirrorHtml; },
    getMirrorText() { return document!.mirrorText; },
    acceptBodyHtml(bodyHtml: string) {
      if (document!.mirrorHtml === bodyHtml) return;
      document!.mirrorHtml = bodyHtml;
      emit(document!);
    },
    subscribe(listener: () => void) {
      document!.listeners.add(listener);
      return () => document!.listeners.delete(listener);
    },
    acquireView() {
      document!.viewCount += 1;
    },
    releaseView() {
      document!.viewCount = Math.max(0, document!.viewCount - 1);
    },
    markInitialized() {
      const authority = document!.attachments.values().next().value as SessionRecord | undefined;
      if (authority) document!.model = measureDataflow("editor.derived-initialize", { documentId, revision: document!.revision }, () => document!.derivedModel.update(authority.editor.getEditorState(), document!.revision));
      document!.initialized = true;
      document!.needsSourceRefresh = false;
      emit(document!);
    },
    getRevision() { return document!.revision; },
    nextRevision() {
      document!.revision += 1;
      return document!.revision;
    },
    getIncarnation() { return document!.incarnation; },
    replaceSource() {
      document!.incarnation += 1;
      document!.revision += 1;
      document!.historyState.current = null;
      document!.historyState.undoStack = [];
      document!.historyState.redoStack = [];
      return document!.incarnation;
    },
    getModel(editorState, revision = document!.revision) {
      if (editorState && (!document!.model || document!.model.revision !== revision)) document!.model = document!.derivedModel.update(editorState, revision);
      return document!.model ?? document!.derivedModel.update(editorState ?? document!.attachments.values().next().value!.editor.getEditorState(), revision);
    },
    getViewScroll(key: string) { return document!.viewScroll.get(key) ?? 0; },
    setViewScroll(key: string, scrollTop: number) { document!.viewScroll.set(key, scrollTop); },
    dispose() {
      for (const attachment of document!.attachments.values()) attachment.unregisterUpdate();
      sessions.delete(document!.documentId);
      document!.listeners.clear();
      document!.attachments.clear();
    }
    } as DocumentSessionRecord;
    sessions.set(documentId, document);
  }

  const existing = document.attachments.get(viewId);
  if (existing) {
    existing.acquireView();
    return existing;
  }

  const editor = createAmaniteEditor(`amanite-document-${documentId}-${viewId}`);
  const sourceAttachment = document.attachments.values().next().value as SessionRecord | undefined;
  if (sourceAttachment) {
    editor.setEditorState(sourceAttachment.editor.getEditorState().clone(null), { tag: AMANITE_VIEW_SYNC_TAG });
  } else {
    editor.update(() => {
      if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode());
    }, { discrete: true, tag: AMANITE_VIEW_SYNC_TAG });
  }
  const session = {
    documentId,
    projectGeneration,
    editor,
    context: createLexicalComposerContext(null, editorLexicalTheme),
    historyState: document.historyState,
    get initialized() { return document!.initialized; },
    get needsSourceRefresh() { return document!.needsSourceRefresh; },
    get viewCount() { return document!.viewCount; },
    getRevision: document.getRevision,
    nextRevision: document.nextRevision,
    getIncarnation: document.getIncarnation,
    replaceSource: document.replaceSource,
    getModel: document.getModel,
    getMirrorHtml: document.getMirrorHtml,
    getMirrorText: document.getMirrorText,
    acceptBodyHtml: document.acceptBodyHtml,
    subscribe: document.subscribe,
    acquireView: document.acquireView,
    releaseView: document.releaseView,
    markInitialized: document.markInitialized,
    getViewScroll: document.getViewScroll,
    setViewScroll: document.setViewScroll,
    dispose: document.dispose,
    unregisterUpdate: () => undefined
  } as SessionRecord;

  session.unregisterUpdate = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState, tags }) => {
    if (tags.has(AMANITE_VIEW_SYNC_TAG)) return;
    for (const peer of document!.attachments.values()) {
      if (peer.editor !== editor) {
        let selection = tags.has(AMANITE_HTML_LOAD_TAG) ? null : peer.editor.getEditorState().read(() => $getSelection()?.clone() ?? null);
        if (selection) {
          try {
            editorState.read(() => selection?.getNodes(), { editor: peer.editor });
          } catch {
            selection = null;
          }
        }
        peer.editor.setEditorState(editorState.clone(selection), { tag: AMANITE_VIEW_SYNC_TAG });
      }
    }
    if (!document!.initialized) return;
    if (tags.has(AMANITE_DERIVED_LINK_TAG)) return;
    document!.model = measureDataflow("editor.changed-block-scan", { documentId, revision: document!.revision + 1 }, () => document!.derivedModel.update(editorState, document!.revision + 1, dirtyElements, dirtyLeaves));
    emit(document!);
  });
  session.acquireView();
  document.attachments.set(viewId, session);
  return session;
}

export function useSharedDocumentEditor(documentId: string, projectGeneration: number, initialBodyHtml: string, viewId = "default", initialRevision = 0, initialIncarnation = 1) {
  const session = useMemo(
    () => acquireSharedDocumentEditor(documentId, projectGeneration, initialBodyHtml, viewId, initialRevision, initialIncarnation),
    [documentId, projectGeneration, viewId]
  );
  useEffect(() => () => releaseSharedDocumentEditor(session), [session]);
  return session;
}

export function releaseSharedDocumentEditor(session: SharedDocumentEditorSession) {
  session.releaseView();
}

export function SharedLexicalComposer({ children, session }: { children: ReactNode; session: SharedDocumentEditorSession }) {
  const value = useMemo<[LexicalEditor, LexicalComposerContextType]>(() => [session.editor, session.context], [session]);
  return <LexicalComposerContext.Provider value={value}>{children}</LexicalComposerContext.Provider>;
}

export function disposeSharedDocumentEditors(projectGeneration: number) {
  for (const session of Array.from(sessions.values())) {
    if (session.projectGeneration === projectGeneration && session.viewCount === 0) session.dispose();
  }
}

export function sharedDocumentEditorCount() {
  return sessions.size;
}
