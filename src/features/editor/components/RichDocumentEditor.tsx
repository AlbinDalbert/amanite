import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $getRoot } from "lexical";
import { type PointerEvent, useMemo } from "react";
import { editorLexicalTheme } from "./editorLexicalTheme";
import EditorToolbar from "./EditorToolbar";
import HtmlBridgePlugin from "./HtmlBridgePlugin";

type Props = {
  bodyHtml: string;
  isBusy: boolean;
  pagePath: string;
  title: string;
  onChangeBody: (html: string) => void;
  onChangeTitle: (title: string) => void;
  onToggleInspector: () => void;
};

type WritingAreaProps = Pick<Props, "bodyHtml" | "isBusy" | "pagePath" | "title" | "onChangeBody" | "onChangeTitle">;

function WritingArea({ bodyHtml, isBusy, pagePath, title, onChangeBody, onChangeTitle }: WritingAreaProps) {
  const [editor] = useLexicalComposerContext();

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches(".rich-page-column, .rich-body-frame, .rich-content-editable")) return;

    event.preventDefault();
    editor.update(() => $getRoot().selectEnd(), {
      onUpdate: () => editor.focus()
    });
  }

  return (
    <article className="rich-page-canvas">
      <div className="rich-page-column" onPointerDown={handlePointerDown}>
        <label className="document-title-field">
          <span>Document title</span>
          <input disabled={isBusy} onChange={(event) => onChangeTitle(event.currentTarget.value)} placeholder="Untitled" value={title} />
        </label>
        <div className="rich-body-frame">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={`Body for ${pagePath}`} className="rich-content-editable" />}
            placeholder={<div className="rich-placeholder">Start writing…</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <HtmlBridgePlugin bodyHtml={bodyHtml} pagePath={pagePath} onChange={onChangeBody} />
        </div>
      </div>
    </article>
  );
}

function RichDocumentEditor({ bodyHtml, isBusy, pagePath, title, onChangeBody, onChangeTitle, onToggleInspector }: Props) {
  const config = useMemo(() => ({
    namespace: `amanite-${pagePath}`,
    nodes: [HeadingNode, LinkNode, ListItemNode, ListNode, QuoteNode],
    onError(error: Error) { throw error; },
    theme: editorLexicalTheme
  }), [pagePath]);

  return (
    <section className="rich-document-shell" aria-label="Rich text editor">
      <LexicalComposer initialConfig={config} key={pagePath}>
        <header className="rich-editor-header">
          <EditorToolbar />
          <span className="toolbar-divider" />
          <button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button>
        </header>
        <WritingArea
          bodyHtml={bodyHtml}
          isBusy={isBusy}
          pagePath={pagePath}
          title={title}
          onChangeBody={onChangeBody}
          onChangeTitle={onChangeTitle}
        />
      </LexicalComposer>
    </section>
  );
}

export default RichDocumentEditor;
