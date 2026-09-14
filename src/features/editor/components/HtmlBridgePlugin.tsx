import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState } from "lexical";
import { useCallback, useEffect, useRef } from "react";
import { registerEditorFlush, type EditorSnapshot } from "./editorFlush";
import { AMANITE_DERIVED_LINK_TAG, AMANITE_HTML_LOAD_TAG, importHtmlIntoEditorInBatches } from "./editorHtml";
import { cleanEditorHtml } from "./editorHtml";
import { readEditorModel, type EditorModelSnapshot } from "./editorModel";
import type { SharedDocumentEditorSession } from "./sharedDocumentEditor";

type Props = {
  bodyHtml: string;
  documentId?: string;
  pagePath: string;
  sharedSession?: SharedDocumentEditorSession;
  onChange?: (html: string) => void;
  onModelChange?: (snapshot: EditorModelSnapshot) => void;
  onRevision?: (revision: number) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  onLoaded?: () => void;
  onLoading?: () => void;
};

function HtmlBridgePlugin({ bodyHtml, documentId, pagePath, sharedSession, onChange, onModelChange, onRevision, onSnapshot, onLoaded, onLoading }: Props) {
  const [editor] = useLexicalComposerContext();
  const editorDocumentId = documentId ?? pagePath;
  const loadedPage = useRef<string | null>(null);
  const lastHtml = useRef(bodyHtml);
  const onChangeRef = useRef(onChange);
  const onModelChangeRef = useRef(onModelChange);
  const onRevisionRef = useRef(onRevision);
  const onSnapshotRef = useRef(onSnapshot);
  const onLoadedRef = useRef(onLoaded);
  const onLoadingRef = useRef(onLoading);
  const revisionRef = useRef(0);
  const pendingState = useRef<EditorState | null>(null);
  const pendingRevision = useRef<number | null>(null);
  const lastSnapshot = useRef<EditorSnapshot | null>(null);
  onChangeRef.current = onChange;
  onModelChangeRef.current = onModelChange;
  onRevisionRef.current = onRevision;
  onSnapshotRef.current = onSnapshot;
  onLoadedRef.current = onLoaded;
  onLoadingRef.current = onLoading;

  const currentRevision = useCallback(() => sharedSession?.getRevision() ?? revisionRef.current, [sharedSession]);

  const reportModel = useCallback((state: EditorState, revision: number) => {
    onModelChangeRef.current?.(readEditorModel(state, revision));
  }, []);

  const exportPendingState = useCallback((minimumRevision = 0): EditorSnapshot | void => {
    const editorRevision = currentRevision();
    const pendingAt = pendingRevision.current ?? -1;
    const revision = Math.max(editorRevision, pendingAt);
    if (!pendingState.current && lastSnapshot.current && lastSnapshot.current.revision >= minimumRevision && lastSnapshot.current.revision >= revision) return lastSnapshot.current;
    if (revision < minimumRevision) return lastSnapshot.current?.revision === revision ? lastSnapshot.current : undefined;
    const state = pendingState.current && pendingAt >= editorRevision
      ? pendingState.current
      : minimumRevision > 0 && revision > 0
        ? editor.getEditorState()
        : null;
    if (!state) return lastSnapshot.current && lastSnapshot.current.revision >= minimumRevision ? lastSnapshot.current : undefined;
    pendingState.current = null;
    pendingRevision.current = null;
    const html = state.read(() => cleanEditorHtml($generateHtmlFromNodes(editor)), { editor });
    const snapshot = { bodyHtml: html, revision };
    lastSnapshot.current = snapshot;
    lastHtml.current = html;
    sharedSession?.acceptBodyHtml(html);
    onSnapshotRef.current?.(snapshot);
    onChangeRef.current?.(html);
    return snapshot;
  }, [currentRevision, editor]);

  useEffect(() => {
    if (sharedSession?.initialized && loadedPage.current === null && (!sharedSession.needsSourceRefresh || bodyHtml === sharedSession.getMirrorHtml())) {
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      sharedSession.markInitialized();
      reportModel(editor.getEditorState(), currentRevision());
      onLoadedRef.current?.();
      return;
    }
    if (loadedPage.current === editorDocumentId && bodyHtml === lastHtml.current) return;
    onLoadingRef.current?.();
    if (sharedSession?.initialized && bodyHtml !== sharedSession.getMirrorHtml()) sharedSession.resetRevision();
    lastSnapshot.current = null;
    const cancelImport = importHtmlIntoEditorInBatches(editor, bodyHtml, () => {
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      sharedSession?.acceptBodyHtml(bodyHtml);
      sharedSession?.markInitialized();
      reportModel(editor.getEditorState(), currentRevision());
      onLoadedRef.current?.();
    });
    return cancelImport;
  }, [bodyHtml, currentRevision, editor, editorDocumentId, pagePath, reportModel, sharedSession]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const handleFocusOut = (event: FocusEvent) => {
      if (!root.contains(event.relatedTarget as Node | null)) exportPendingState();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") exportPendingState();
    };
    root.addEventListener("focusout", handleFocusOut);
    root.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      root.removeEventListener("focusout", handleFocusOut);
      root.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [editor, exportPendingState]);

  const getRevision = useCallback(() => currentRevision(), [currentRevision]);

  useEffect(() => registerEditorFlush(editorDocumentId, { flush: (minimumRevision) => Promise.resolve(exportPendingState(minimumRevision)), getRevision }), [editorDocumentId, exportPendingState, getRevision]);

  useEffect(() => () => { void exportPendingState(); }, [exportPendingState]);

  function handleChange(state: EditorState, _editor: unknown, tags: Set<string>) {
    if (tags.has(AMANITE_HTML_LOAD_TAG) || tags.has(AMANITE_DERIVED_LINK_TAG)) return;
    const revision = sharedSession?.nextRevision() ?? (revisionRef.current += 1);
    onRevisionRef.current?.(revision);
    reportModel(state, revision);
    pendingState.current = state;
    pendingRevision.current = revision;
  }

  return <OnChangePlugin ignoreHistoryMergeTagChange ignoreSelectionChange onChange={handleChange} />;
}

export default HtmlBridgePlugin;
