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
import { CodeNode } from "@lexical/code";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { $getRoot, $insertNodes } from "lexical";
import { type ClipboardEvent, type DragEvent, type PointerEvent, useEffect, useMemo } from "react";
import type { FractalLink, FractalPage } from "@/lib/fractal/types";
import { DerivedLinkNode } from "./DerivedLinkNode";
import { editorLexicalTheme } from "./editorLexicalTheme";
import EditorToolbar from "./EditorToolbar";
import HtmlBridgePlugin from "./HtmlBridgePlugin";
import InlinePageLinksPlugin from "./InlinePageLinksPlugin";
import { $createImageNode, IframeNode, ImageNode } from "./MediaNodes";

type Props = {
  bodyHtml: string;
  isBusy: boolean;
  pagePath: string;
  pages: FractalPage[];
  spellCheck: boolean;
  title: string;
  onChangeBody: (html: string) => void;
  onChangeTitle: (title: string) => void;
  onToggleInspector: () => void;
};

type WritingAreaProps = Pick<Props, "bodyHtml" | "isBusy" | "pagePath" | "pages" | "spellCheck" | "title" | "onChangeBody" | "onChangeTitle">;

function EditableStatePlugin({ isBusy }: { isBusy: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!isBusy), [editor, isBusy]);
  return null;
}

export function resolveEditorLinkTarget(href: string, links: FractalLink[], pagePath: string, pages: FractalPage[]) {
  const link = links.find((candidate) => candidate.href === href
    || (!/^[a-z][a-z0-9+.-]*:/i.test(candidate.href) && `https://${candidate.href}` === href));
  if (link?.target.kind === "internal") return link.target.value;
  if (link?.target.kind === "internal_file" && link.target.value.toLowerCase().endsWith(".html")) return link.target.value;
  try {
    const base = new URL(pagePath, "https://amanite.local/");
    const resolved = decodeURIComponent(new URL(href, base).pathname.replace(/^\//, ""));
    return pages.some((page) => page.path === resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function WritingArea({ bodyHtml, isBusy, pagePath, pages, spellCheck, title, onChangeBody, onChangeTitle }: WritingAreaProps) {
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

  function insertImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => editor.update(() => $insertNodes([$createImageNode(String(reader.result), file.name.replace(/\.[^.]+$/, ""))]));
    reader.readAsDataURL(file);
  }

  function handlePaste(event: ClipboardEvent) {
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    insertImageFile(image);
  }

  function handleDrop(event: DragEvent) {
    const image = Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    insertImageFile(image);
  }

  return (
    <article className="rich-page-canvas">
      <div className="rich-page-column" onPointerDown={handlePointerDown}>
        <label className="document-title-field">
          <input aria-label="Document title" disabled={isBusy} onChange={(event) => onChangeTitle(event.currentTarget.value)} placeholder="Untitled" value={title} />
        </label>
        <div className="rich-body-frame">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={`Body for ${pagePath}`} className="rich-content-editable" onDrop={handleDrop} onPaste={handlePaste} spellCheck={spellCheck} />}
            placeholder={<div className="rich-placeholder">Start writing…</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <EditableStatePlugin isBusy={isBusy} />
          <ListPlugin />
          <TabIndentationPlugin />
          <LinkPlugin />
          <HorizontalRulePlugin />
          <TablePlugin />
          <HtmlBridgePlugin bodyHtml={bodyHtml} pagePath={pagePath} onChange={onChangeBody} />
          <InlinePageLinksPlugin pagePath={pagePath} pages={pages} />
        </div>
      </div>
    </article>
  );
}

function RichDocumentEditor({ bodyHtml, isBusy, pagePath, pages, spellCheck, title, onChangeBody, onChangeTitle, onToggleInspector }: Props) {
  const config = useMemo(() => ({
    namespace: `amanite-${pagePath}`,
    nodes: [CodeNode, DerivedLinkNode, HeadingNode, HorizontalRuleNode, IframeNode, ImageNode, LinkNode, ListItemNode, ListNode, QuoteNode, TableCellNode, TableNode, TableRowNode],
    onError(error: Error) { throw error; },
    theme: editorLexicalTheme
  }), [pagePath]);

  return (
    <section className="rich-document-shell" aria-label="Rich text editor">
      <LexicalComposer initialConfig={config} key={pagePath}>
        <header className="rich-editor-header">
          <EditorToolbar disabled={isBusy} pagePath={pagePath} pages={pages} />
          <span className="toolbar-divider" />
          <button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button>
        </header>
        <WritingArea
          bodyHtml={bodyHtml}
          isBusy={isBusy}
          pagePath={pagePath}
          pages={pages}
          spellCheck={spellCheck}
          title={title}
          onChangeBody={onChangeBody}
          onChangeTitle={onChangeTitle}
        />
      </LexicalComposer>
    </section>
  );
}

export default RichDocumentEditor;
