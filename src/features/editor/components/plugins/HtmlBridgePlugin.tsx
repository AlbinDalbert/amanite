import { $generateHtmlFromNodes } from "@lexical/html";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  type EditorState,
  type LexicalEditor as LexicalEditorInstance
} from "lexical";
import { useEffect, useRef } from "react";
import {
  AMANITE_HTML_LOAD_TAG,
  importHtmlIntoEditor,
  sanitizeFractalBodyHtml
} from "../editorHtml";

type HtmlBridgePluginProps = {
  bodyHtml: string;
  pagePath: string;
  onChangeBodyHtml: (bodyHtml: string) => void;
};

function HtmlBridgePlugin({ bodyHtml, pagePath, onChangeBodyHtml }: HtmlBridgePluginProps) {
  const [editor] = useLexicalComposerContext();
  const loadedPagePathRef = useRef<string | null>(null);
  const lastEmittedHtmlRef = useRef(bodyHtml);

  useEffect(() => {
    const isNewPage = loadedPagePathRef.current !== pagePath;
    const isExternalUpdate = bodyHtml !== lastEmittedHtmlRef.current;

    if (!isNewPage && !isExternalUpdate) {
      return;
    }

    editor.update(() => importHtmlIntoEditor(editor, bodyHtml), {
      tag: AMANITE_HTML_LOAD_TAG
    });
    loadedPagePathRef.current = pagePath;
    lastEmittedHtmlRef.current = bodyHtml;
  }, [bodyHtml, editor, pagePath]);

  function handleChange(
    editorState: EditorState,
    lexicalEditor: LexicalEditorInstance,
    tags: Set<string>
  ) {
    if (tags.has(AMANITE_HTML_LOAD_TAG)) {
      return;
    }

    const nextBodyHtml = editorState.read(
      () => sanitizeFractalBodyHtml($generateHtmlFromNodes(lexicalEditor, null)),
      { editor: lexicalEditor }
    );

    lastEmittedHtmlRef.current = nextBodyHtml;
    onChangeBodyHtml(nextBodyHtml);
  }

  return (
    <OnChangePlugin
      ignoreHistoryMergeTagChange
      ignoreSelectionChange
      onChange={handleChange}
    />
  );
}

export default HtmlBridgePlugin;
