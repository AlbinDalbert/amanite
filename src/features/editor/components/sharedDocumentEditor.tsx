import { $generateHtmlFromNodes } from "@lexical/html";
import { createLexicalComposerContext, LexicalComposerContext, type LexicalComposerContextType } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";
import { createAmaniteEditor } from "./editorConfig";
import { cleanEditorHtml } from "./editorHtml";
import { editorLexicalTheme } from "./editorLexicalTheme";
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type SharedDocumentEditorSession = {
  documentId: string;
  projectGeneration: number;
  editor: LexicalEditor;
  context: LexicalComposerContextType;
  initialized: boolean;
  needsSourceRefresh: boolean;
  viewCount: number;
  getMirrorHtml: () => string;
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
    viewCount: 0,
    mirrorHtml: initialBodyHtml || "<p></p>",
    listeners: new Set<() => void>(),
    viewScroll: new Map<string, number>(),
    unregisterUpdate: () => undefined,
    getMirrorHtml() { return session.mirrorHtml; },
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
      session.initialized = true;
      session.needsSourceRefresh = false;
      emit(session);
    },
    getViewScroll(viewId: string) { return session.viewScroll.get(viewId) ?? 0; },
    setViewScroll(viewId: string, scrollTop: number) { session.viewScroll.set(viewId, scrollTop); },
    dispose() {
      session.unregisterUpdate();
      sessions.delete(session.documentId);
      session.listeners.clear();
    }
  } as SessionRecord;

  session.unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
    const html = editorState.read(() => cleanEditorHtml($generateHtmlFromNodes(editor)), { editor });
    if (html === session.mirrorHtml) return;
    session.mirrorHtml = html;
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
  return useSyncExternalStore(session.subscribe, session.getMirrorHtml, session.getMirrorHtml);
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
