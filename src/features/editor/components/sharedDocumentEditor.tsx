import { createLexicalComposerContext, LexicalComposerContext, type LexicalComposerContextType } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { createAmaniteEditor } from "./editorConfig";
import { AMANITE_DERIVED_LINK_TAG } from "./editorHtml";
import { readEditorModel } from "./editorModel";
import { editorLexicalTheme } from "./editorLexicalTheme";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type SharedDocumentEditorSession = {
  documentId: string;
  projectGeneration: number;
  editor: LexicalEditor;
  context: LexicalComposerContextType;
  initialized: boolean;
  needsSourceRefresh: boolean;
  getRevision: () => number;
  nextRevision: () => number;
  resetRevision: () => void;
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
  listeners: Set<() => void>;
  viewScroll: Map<string, number>;
  unregisterUpdate: () => void;
};

const sessions = new Map<string, SessionRecord>();

function emit(session: SessionRecord) {
  for (const listener of session.listeners) listener();
}

export function acquireSharedDocumentEditor(documentId: string, projectGeneration: number, initialBodyHtml: string): SharedDocumentEditorSession {
  const existing = sessions.get(documentId);
  if (existing) {
    existing.acquireView();
    return existing;
  }

  const editor = createAmaniteEditor(`amanite-document-${documentId}`);
  const context = createLexicalComposerContext(null, editorLexicalTheme);
  const session = {
    documentId,
    projectGeneration,
    editor,
    context,
    initialized: false,
    needsSourceRefresh: false,
    revision: 0,
    viewCount: 0,
    mirrorHtml: initialBodyHtml || "<p></p>",
    mirrorText: null,
    listeners: new Set<() => void>(),
    viewScroll: new Map<string, number>(),
    unregisterUpdate: () => undefined,
    getMirrorHtml() { return session.mirrorHtml; },
    getMirrorText() { return session.mirrorText; },
    acceptBodyHtml(bodyHtml: string) {
      if (session.mirrorHtml === bodyHtml) return;
      session.mirrorHtml = bodyHtml;
      emit(session);
    },
    subscribe(listener: () => void) {
      session.listeners.add(listener);
      return () => session.listeners.delete(listener);
    },
    acquireView() {
      if (session.viewCount === 0 && session.initialized) session.needsSourceRefresh = true;
      session.viewCount += 1;
    },
    releaseView() {
      session.viewCount = Math.max(0, session.viewCount - 1);
      if (session.viewCount === 0) session.needsSourceRefresh = true;
    },
    markInitialized() {
      session.mirrorText = readEditorModel(session.editor.getEditorState(), session.revision).text;
      session.initialized = true;
      session.needsSourceRefresh = false;
      emit(session);
    },
    getRevision() { return session.revision; },
    nextRevision() {
      session.revision += 1;
      return session.revision;
    },
    resetRevision() { session.revision = 0; },
    getViewScroll(viewId: string) { return session.viewScroll.get(viewId) ?? 0; },
    setViewScroll(viewId: string, scrollTop: number) { session.viewScroll.set(viewId, scrollTop); },
    dispose() {
      session.unregisterUpdate();
      sessions.delete(session.documentId);
      session.listeners.clear();
    }
  } as SessionRecord;

  session.unregisterUpdate = editor.registerUpdateListener(({ editorState, tags }) => {
    if (!session.initialized) return;
    if (tags.has(AMANITE_DERIVED_LINK_TAG)) return;
    const text = readEditorModel(editorState, session.revision).text;
    if (text === session.mirrorText) return;
    session.mirrorText = text;
    emit(session);
  });
  editor.update(() => {
    if (!$getRoot().getChildrenSize()) $getRoot().append($createParagraphNode());
  }, { tag: "history-merge" });
  session.acquireView();
  sessions.set(documentId, session);
  return session;
}

export function useSharedDocumentEditor(documentId: string, projectGeneration: number, initialBodyHtml: string) {
  const session = useMemo(
    () => acquireSharedDocumentEditor(documentId, projectGeneration, initialBodyHtml),
    [documentId, projectGeneration]
  );
  useEffect(() => () => releaseSharedDocumentEditor(session), [session]);
  return session;
}

export function releaseSharedDocumentEditor(session: SharedDocumentEditorSession) {
  session.releaseView();
}

export function useSharedDocumentMirror(session: SharedDocumentEditorSession) {
  return useSyncExternalStore(session.subscribe, session.getMirrorText, session.getMirrorText);
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
