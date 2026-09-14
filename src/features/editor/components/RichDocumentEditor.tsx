import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { $getRoot } from "lexical";
import { type PointerEvent, useEffect, useMemo, useState } from "react";
import TreeLocation, { displayPagePath } from "@/components/ui/TreeLocation";
import type { FractalLink, FractalPage } from "@/lib/fractal/types";
import EditorToolbar from "./EditorToolbar";
import HtmlBridgePlugin from "./HtmlBridgePlugin";
import InlinePageLinksPlugin from "./InlinePageLinksPlugin";
import DocumentLoadingPreview from "./DocumentLoadingPreview";
import { editorConfig } from "./editorConfig";
import type { EditorSnapshot } from "./editorFlush";
import type { EditorModelSnapshot } from "./editorModel";
import { SharedLexicalComposer, useSharedDocumentMirror, type SharedDocumentEditorSession } from "./sharedDocumentEditor";

type Props = {
  bodyHtml: string;
  embedded?: boolean;
  isBusy: boolean;
  pagePath: string;
  pages: FractalPage[];
  projectName?: string;
  spellCheck: boolean;
  title: string;
  documentId?: string;
  sharedSession?: SharedDocumentEditorSession;
  viewId?: string;
  onChangeBody: (html: string) => void;
  onModelChange?: (snapshot: EditorModelSnapshot) => void;
  onChangeTitle: (title: string) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  onRevision?: (revision: number) => void;
  onOpenFolder?: (folderPath: string) => void;
  onToggleInspector?: () => void;
};

type WritingAreaProps = Pick<Props, "bodyHtml" | "documentId" | "isBusy" | "pagePath" | "pages" | "projectName" | "sharedSession" | "spellCheck" | "title" | "viewId" | "onChangeBody" | "onChangeTitle" | "onModelChange" | "onOpenFolder" | "onSnapshot"> & {
  onContentLoaded: () => void;
  onContentLoading: () => void;
  onRevision?: (revision: number) => void;
  documentId?: string;
  sharedSession?: SharedDocumentEditorSession;
  viewId?: string;
};

export function ReadOnlyDocumentMirror({ bodyHtml, embedded = false, pagePath, session, title }: { bodyHtml: string; embedded?: boolean; pagePath: string; session: SharedDocumentEditorSession; title: string }) {
  const liveText = useSharedDocumentMirror(session);
  return (
    <section aria-label="Read-only document view" className={embedded ? "rich-document-shell embedded document-mirror" : "rich-document-shell document-mirror"}>
      <article className="rich-page-canvas">
        <div className="rich-page-column">
          <div className="document-page-heading">
            <label className="document-title-field"><input aria-label="Document title" disabled placeholder="Untitled" value={title} readOnly /></label>
          </div>
          <div className="rich-body-frame">
            {liveText === null ? (
              <div aria-label={`Read-only body for ${pagePath}`} className="rich-content-editable document-mirror-content" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
            ) : (
              <div aria-label={`Read-only body for ${pagePath}`} className="rich-content-editable document-mirror-content">{liveText}</div>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}

function EditableStatePlugin({ isBusy }: { isBusy: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!isBusy), [editor, isBusy]);
  return null;
}

function ViewAttachmentPlugin({ session, viewId }: { session?: SharedDocumentEditorSession; viewId?: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!session || !viewId) return;
    let frame = 0;
    let root: HTMLElement | null = null;
    const saveScroll = () => {
      if (root) session.setViewScroll(viewId, root.scrollTop);
    };
    const attach = () => {
      root = editor.getRootElement();
      if (!root) return;
      root.scrollTop = session.getViewScroll(viewId);
      root.addEventListener("scroll", saveScroll, { passive: true });
    };
    frame = window.requestAnimationFrame(attach);
    return () => {
      window.cancelAnimationFrame(frame);
      saveScroll();
      root?.removeEventListener("scroll", saveScroll);
    };
  }, [editor, session, viewId]);
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

function WritingArea({ bodyHtml, documentId, isBusy, pagePath, pages, projectName, sharedSession, spellCheck, title, viewId, onChangeBody, onChangeTitle, onModelChange, onContentLoaded, onContentLoading, onOpenFolder, onRevision, onSnapshot }: WritingAreaProps) {
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
          <HtmlBridgePlugin bodyHtml={bodyHtml} documentId={documentId ?? pagePath} pagePath={pagePath} sharedSession={sharedSession} onChange={onChangeBody} onModelChange={onModelChange} onRevision={onRevision} onSnapshot={onSnapshot} onLoaded={onContentLoaded} onLoading={onContentLoading} />
          <InlinePageLinksPlugin pagePath={pagePath} pages={pages} />
          <ViewAttachmentPlugin session={sharedSession} viewId={viewId} />
        </div>
      </div>
    </article>
  );
}

function RichDocumentEditor({ bodyHtml, documentId, embedded = false, isBusy, pagePath, pages, projectName, sharedSession, spellCheck, title, viewId, onChangeBody, onChangeTitle, onModelChange, onOpenFolder, onRevision, onSnapshot, onToggleInspector }: Props) {
  const [isContentReady, setIsContentReady] = useState(false);
  const editorBusy = isBusy || !isContentReady;
  const config = useMemo(() => editorConfig(`amanite-${documentId ?? pagePath}`), [documentId, pagePath]);
  const writingArea = (
    <>
      <header className="rich-editor-header">
        <EditorToolbar disabled={editorBusy} pagePath={pagePath} pages={pages} />
        {onToggleInspector ? <><span className="toolbar-divider" /><button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button></> : null}
      </header>
      <WritingArea
        bodyHtml={bodyHtml}
        documentId={documentId}
        isBusy={editorBusy}
        pagePath={pagePath}
        pages={pages}
        projectName={projectName}
        sharedSession={sharedSession}
        spellCheck={spellCheck}
        title={title}
        viewId={viewId}
        onChangeBody={onChangeBody}
        onChangeTitle={onChangeTitle}
        onModelChange={onModelChange}
        onContentLoaded={() => setIsContentReady(true)}
        onContentLoading={() => setIsContentReady(false)}
        onOpenFolder={onOpenFolder}
        onRevision={onRevision}
        onSnapshot={onSnapshot}
      />
    </>
  );

  return (
    <section className={embedded ? "rich-document-shell embedded" : "rich-document-shell"} aria-label="Rich text editor">
      {!isContentReady ? <DocumentLoadingPreview title={title || "Untitled"} /> : null}
      {sharedSession ? (
        <SharedLexicalComposer session={sharedSession}>{writingArea}</SharedLexicalComposer>
      ) : (
        <LexicalComposer initialConfig={config} key={documentId ?? pagePath}>{writingArea}</LexicalComposer>
      )}
    </section>
  );
}

export default RichDocumentEditor;
