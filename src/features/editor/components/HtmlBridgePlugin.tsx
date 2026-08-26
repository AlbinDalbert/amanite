import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState } from "lexical";
import { useCallback, useEffect, useRef } from "react";
import { AMANITE_HTML_LOAD_TAG, cleanEditorHtml, importHtmlIntoEditor } from "./editorHtml";

type Props = {
  bodyHtml: string;
  pagePath: string;
  onChange: (html: string) => void;
};

const HTML_EXPORT_DELAY_MS = 120;

function HtmlBridgePlugin({ bodyHtml, pagePath, onChange }: Props) {
  const [editor] = useLexicalComposerContext();
  const loadedPage = useRef<string | null>(null);
  const lastHtml = useRef(bodyHtml);
  const onChangeRef = useRef(onChange);
  const pendingState = useRef<EditorState | null>(null);
  const exportTimeout = useRef<number | null>(null);
  onChangeRef.current = onChange;

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
    if (loadedPage.current === pagePath && bodyHtml === lastHtml.current) return;
    editor.update(() => importHtmlIntoEditor(editor, bodyHtml), { tag: AMANITE_HTML_LOAD_TAG });
    loadedPage.current = pagePath;
    lastHtml.current = bodyHtml;
  }, [bodyHtml, editor, pagePath]);

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

  useEffect(() => () => exportPendingState(), [exportPendingState]);

  function handleChange(state: EditorState, _editor: unknown, tags: Set<string>) {
    if (tags.has(AMANITE_HTML_LOAD_TAG)) return;
    pendingState.current = state;
    if (exportTimeout.current != null) window.clearTimeout(exportTimeout.current);
    exportTimeout.current = window.setTimeout(exportPendingState, HTML_EXPORT_DELAY_MS);
  }

  return <OnChangePlugin ignoreHistoryMergeTagChange ignoreSelectionChange onChange={handleChange} />;
}

export default HtmlBridgePlugin;
