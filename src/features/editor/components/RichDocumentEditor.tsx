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
import { $getRoot } from "lexical";
import { type PointerEvent, useEffect, useMemo, useState } from "react";
import TreeLocation, { displayPagePath } from "@/components/ui/TreeLocation";
import type { FractalLink, FractalPage } from "@/lib/fractal/types";
import { DerivedLinkNode } from "./DerivedLinkNode";
import { editorLexicalTheme } from "./editorLexicalTheme";
import EditorToolbar from "./EditorToolbar";
import HtmlBridgePlugin from "./HtmlBridgePlugin";
import InlinePageLinksPlugin from "./InlinePageLinksPlugin";
import DocumentLoadingPreview from "./DocumentLoadingPreview";

type Props = {
  bodyHtml: string;
  embedded?: boolean;
  isBusy: boolean;
  pagePath: string;
  pages: FractalPage[];
  projectName?: string;
  spellCheck: boolean;
  title: string;
  onChangeBody: (html: string) => void;
  onChangeTitle: (title: string) => void;
  onOpenFolder?: (folderPath: string) => void;
  onToggleInspector?: () => void;
};

type WritingAreaProps = Pick<Props, "bodyHtml" | "isBusy" | "pagePath" | "pages" | "projectName" | "spellCheck" | "title" | "onChangeBody" | "onChangeTitle" | "onOpenFolder"> & {
  onContentLoaded: () => void;
  onContentLoading: () => void;
};

function EditableStatePlugin({ isBusy }: { isBusy: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!isBusy), [editor, isBusy]);
  return null;
}

export function resolveEditorLinkTarget(href: string, links: FractalLink[], pagePath: string, pages: FractalPage[]) {
  const link = links.find((candidate) => candidate.href === href
    || (!/^[a-z][a-z0-9+.-]*:/i.test(candidate.href) && `https://${candidate.href}` === href));
  if (link?.target.kind === "resolved") return link.target.value;
  try {
    const base = new URL(pagePath, "https://amanite.local/");
    const resolved = decodeURIComponent(new URL(href, base).pathname.replace(/^\//, ""));
    return pages.some((page) => page.path === resolved) ? resolved : null;
  } catch {
    return null;
  }
}

export { displayPagePath };

function WritingArea({ bodyHtml, isBusy, pagePath, pages, projectName, spellCheck, title, onChangeBody, onChangeTitle, onContentLoaded, onContentLoading, onOpenFolder }: WritingAreaProps) {
  const [editor] = useLexicalComposerContext();
  const parentFolder = pagePath.includes("/") ? pagePath.slice(0, pagePath.lastIndexOf("/")) : "";

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
        <div className="document-page-heading">
          {onOpenFolder && projectName ? (
            <TreeLocation
              currentKind="page"
              disabled={isBusy}
              onNavigateFolder={onOpenFolder}
              onUp={() => onOpenFolder(parentFolder)}
              path={pagePath}
              projectName={projectName}
              upTitle={`Go up to ${parentFolder || "Pages"}`}
            />
          ) : null}
          <label className="document-title-field">
            <input aria-label="Document title" disabled={isBusy} onChange={(event) => onChangeTitle(event.currentTarget.value)} placeholder="Untitled" value={title} />
          </label>
        </div>
        <div className="rich-body-frame">
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label={`Body for ${pagePath}`} className="rich-content-editable" spellCheck={spellCheck} />}
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
          <HtmlBridgePlugin bodyHtml={bodyHtml} pagePath={pagePath} onChange={onChangeBody} onLoaded={onContentLoaded} onLoading={onContentLoading} />
          <InlinePageLinksPlugin pagePath={pagePath} pages={pages} />
        </div>
      </div>
    </article>
  );
}

function RichDocumentEditor({ bodyHtml, embedded = false, isBusy, pagePath, pages, projectName, spellCheck, title, onChangeBody, onChangeTitle, onOpenFolder, onToggleInspector }: Props) {
  const [isContentReady, setIsContentReady] = useState(false);
  const editorBusy = isBusy || !isContentReady;
  const config = useMemo(() => ({
    namespace: `amanite-${pagePath}`,
    nodes: [CodeNode, DerivedLinkNode, HeadingNode, HorizontalRuleNode, LinkNode, ListItemNode, ListNode, QuoteNode, TableCellNode, TableNode, TableRowNode],
    onError(error: Error) { throw error; },
    theme: editorLexicalTheme
  }), [pagePath]);

  return (
    <section className={embedded ? "rich-document-shell embedded" : "rich-document-shell"} aria-label="Rich text editor">
      {!isContentReady ? <DocumentLoadingPreview title={title || "Untitled"} /> : null}
      <LexicalComposer initialConfig={config} key={pagePath}>
        <header className="rich-editor-header">
          <EditorToolbar disabled={editorBusy} pagePath={pagePath} pages={pages} />
          {onToggleInspector ? <><span className="toolbar-divider" /><button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button></> : null}
        </header>
        <WritingArea
          bodyHtml={bodyHtml}
          isBusy={editorBusy}
          pagePath={pagePath}
          pages={pages}
          projectName={projectName}
          spellCheck={spellCheck}
          title={title}
          onChangeBody={onChangeBody}
          onChangeTitle={onChangeTitle}
          onContentLoaded={() => setIsContentReady(true)}
          onContentLoading={() => setIsContentReady(false)}
          onOpenFolder={onOpenFolder}
        />
      </LexicalComposer>
    </section>
  );
}

export default RichDocumentEditor;
