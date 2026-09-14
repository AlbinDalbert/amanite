import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState } from "lexical";
import { useCallback, useEffect, useRef } from "react";
import { registerEditorFlush } from "./editorFlush";
import { AMANITE_DERIVED_LINK_TAG, AMANITE_HTML_LOAD_TAG, importHtmlIntoEditorInBatches } from "./editorHtml";
import { cleanEditorHtml } from "./editorHtml";
import type { SharedDocumentEditorSession } from "./sharedDocumentEditor";

type Props = {
  bodyHtml: string;
  documentId?: string;
  pagePath: string;
  sharedSession?: SharedDocumentEditorSession;
  onChange: (html: string) => void;
  onRevision?: (revision: number) => void;
  onLoaded?: () => void;
  onLoading?: () => void;
};

const HTML_EXPORT_DELAY_MS = 120;

function HtmlBridgePlugin({ bodyHtml, documentId, pagePath, sharedSession, onChange, onRevision, onLoaded, onLoading }: Props) {
  const [editor] = useLexicalComposerContext();
  const editorDocumentId = documentId ?? pagePath;
  const loadedPage = useRef<string | null>(null);
  const lastHtml = useRef(bodyHtml);
  const onChangeRef = useRef(onChange);
  const onRevisionRef = useRef(onRevision);
  const onLoadedRef = useRef(onLoaded);
  const onLoadingRef = useRef(onLoading);
  const revisionRef = useRef(0);
  const pendingState = useRef<EditorState | null>(null);
  const exportTimeout = useRef<number | null>(null);
  onChangeRef.current = onChange;
  onRevisionRef.current = onRevision;
  onLoadedRef.current = onLoaded;
  onLoadingRef.current = onLoading;

  const exportPendingState = useCallback(() => {
    if (exportTimeout.current != null) {
      window.clearTimeout(exportTimeout.current);
      exportTimeout.current = null;
    }
    const state = pendingState.current;
    if (!state) return;
    pendingState.current = null;
    const html = state.read(() => cleanEditorHtml($generateHtmlFromNodes(editor)), { editor });
    lastHtml.current = html;
    onChangeRef.current(html);
  }, [editor]);

  useEffect(() => {
    if (sharedSession?.initialized && loadedPage.current === null && (!sharedSession.needsSourceRefresh || bodyHtml === sharedSession.getMirrorHtml())) {
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      onLoadedRef.current?.();
      return;
    }
    if (loadedPage.current === editorDocumentId && bodyHtml === lastHtml.current) return;
    onLoadingRef.current?.();
    const cancelImport = importHtmlIntoEditorInBatches(editor, bodyHtml, () => {
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      sharedSession?.markInitialized();
      onLoadedRef.current?.();
    });
    return cancelImport;
  }, [bodyHtml, editor, editorDocumentId, pagePath, sharedSession]);

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

  const getRevision = useCallback(() => revisionRef.current, []);

  useEffect(() => registerEditorFlush(editorDocumentId, { flush: exportPendingState, getRevision }), [editorDocumentId, exportPendingState, getRevision]);

  useEffect(() => () => exportPendingState(), [exportPendingState]);

  function handleChange(state: EditorState, _editor: unknown, tags: Set<string>) {
    if (tags.has(AMANITE_HTML_LOAD_TAG) || tags.has(AMANITE_DERIVED_LINK_TAG)) return;
    revisionRef.current += 1;
    onRevisionRef.current?.(revisionRef.current);
    pendingState.current = state;
    if (exportTimeout.current != null) window.clearTimeout(exportTimeout.current);
    exportTimeout.current = window.setTimeout(exportPendingState, HTML_EXPORT_DELAY_MS);
  }

  return <OnChangePlugin ignoreHistoryMergeTagChange ignoreSelectionChange onChange={handleChange} />;
}

export default HtmlBridgePlugin;
