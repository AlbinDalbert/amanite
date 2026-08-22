import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState, LexicalEditor } from "lexical";
import { useEffect, useRef } from "react";
import { AMANITE_HTML_LOAD_TAG, cleanEditorHtml, importHtmlIntoEditor } from "./editorHtml";

type Props = {
  bodyHtml: string;
  pagePath: string;
  onChange: (html: string) => void;
};

function HtmlBridgePlugin({ bodyHtml, pagePath, onChange }: Props) {
  const [editor] = useLexicalComposerContext();
  const loadedPage = useRef<string | null>(null);
  const lastHtml = useRef(bodyHtml);

  useEffect(() => {
    if (loadedPage.current === pagePath && bodyHtml === lastHtml.current) return;
    editor.update(() => importHtmlIntoEditor(editor, bodyHtml), { tag: AMANITE_HTML_LOAD_TAG });
    loadedPage.current = pagePath;
    lastHtml.current = bodyHtml;
  }, [bodyHtml, editor, pagePath]);

  function handleChange(state: EditorState, lexicalEditor: LexicalEditor, tags: Set<string>) {
    if (tags.has(AMANITE_HTML_LOAD_TAG)) return;
    const html = state.read(() => cleanEditorHtml($generateHtmlFromNodes(lexicalEditor)), { editor: lexicalEditor });
    lastHtml.current = html;
    onChange(html);
  }

  return <OnChangePlugin ignoreHistoryMergeTagChange ignoreSelectionChange onChange={handleChange} />;
}

export default HtmlBridgePlugin;
