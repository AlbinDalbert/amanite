import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { useMemo } from "react";
import type { FractalNote } from "@/lib/fractal/types";
import NotesLedger from "./NotesLedger";
import PageMetadataEditor from "./PageMetadataEditor";
import { editorLexicalTheme } from "./editorLexicalTheme";
import type { NoteInteractionsController } from "./useNoteInteractions";
import type { TagEditorController } from "./useTagEditor";
import EditorToolbar from "./plugins/EditorToolbar";
import HtmlBridgePlugin from "./plugins/HtmlBridgePlugin";

type NoteLedgerInteractions = Pick<
  NoteInteractionsController,
  | "cancelEditingNote"
  | "commitNoteEdit"
  | "editingNoteId"
  | "handleNoteDraftKeyDown"
  | "noteDraft"
  | "setNoteDraft"
  | "startEditingNote"
>;

type EditorCanvasProps = {
  bodyHtml: string;
  isBusy: boolean;
  isInspectorOpen: boolean;
  noteInteractions: NoteLedgerInteractions;
  notes: FractalNote[];
  pagePath: string;
  summary?: string | null;
  tagEditor: TagEditorController;
  tags: string[];
  title: string;
  onChangeBodyHtml: (bodyHtml: string) => void;
  onChangeSummary: (summary: string) => void;
  onChangeTitle: (title: string) => void;
  onDeleteNote: (note: FractalNote) => void;
  onToggleInspector: () => void;
};

function EditorCanvas({
  bodyHtml,
  isBusy,
  isInspectorOpen,
  noteInteractions,
  notes,
  pagePath,
  summary,
  tagEditor,
  tags,
  title,
  onChangeBodyHtml,
  onChangeSummary,
  onChangeTitle,
  onDeleteNote,
  onToggleInspector
}: EditorCanvasProps) {
  const editorConfig = useMemo(
    () => ({
      namespace: `amanite-${pagePath}`,
      nodes: [HeadingNode, LinkNode, ListItemNode, ListNode, QuoteNode],
      onError(error: Error) {
        throw error;
      },
      theme: editorLexicalTheme
    }),
    [pagePath]
  );

  return (
    <section className="rich-document-shell" aria-label="Fractal rich editor">
      <LexicalComposer initialConfig={editorConfig} key={pagePath}>
        <header className="rich-editor-header">
          <EditorToolbar />
        </header>

        <button
          className={
            isInspectorOpen
              ? "editor-inspector-toggle floating active"
              : "editor-inspector-toggle floating"
          }
          onClick={onToggleInspector}
          type="button"
        >
          {isInspectorOpen ? "Hide context" : "Inspect"}
        </button>

        <article className="rich-page-canvas">
          <div className="rich-page-column">
            <PageMetadataEditor
              isAddingTag={tagEditor.isAddingTag}
              pagePath={pagePath}
              summary={summary}
              tagDraft={tagEditor.tagDraft}
              tagInputRef={tagEditor.tagInputRef}
              tags={tags}
              title={title}
              onChangeSummary={onChangeSummary}
              onChangeTagDraft={tagEditor.setTagDraft}
              onChangeTitle={onChangeTitle}
              onCommitTagDraft={tagEditor.commitTagDraft}
              onRemoveTag={tagEditor.removeTag}
              onStartAddingTag={tagEditor.startAddingTag}
              onTagInputKeyDown={tagEditor.handleTagInputKeyDown}
            />

            <div className="rich-body-frame">
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    aria-label={`Body for ${pagePath}`}
                    className="rich-content-editable"
                  />
                }
                placeholder={<div className="rich-placeholder">Write this Fractal page...</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ListPlugin />
              <LinkPlugin />
              <AutoFocusPlugin />
              <HtmlBridgePlugin
                bodyHtml={bodyHtml}
                pagePath={pagePath}
                onChangeBodyHtml={onChangeBodyHtml}
              />
            </div>

            <NotesLedger
              editingNoteId={noteInteractions.editingNoteId}
              isBusy={isBusy}
              noteDraft={noteInteractions.noteDraft}
              notes={notes}
              onCancelEditingNote={noteInteractions.cancelEditingNote}
              onChangeNoteDraft={noteInteractions.setNoteDraft}
              onCommitNoteEdit={noteInteractions.commitNoteEdit}
              onDeleteNote={onDeleteNote}
              onNoteDraftKeyDown={noteInteractions.handleNoteDraftKeyDown}
              onStartEditingNote={noteInteractions.startEditingNote}
            />
          </div>
        </article>
      </LexicalComposer>
    </section>
  );
}

export default EditorCanvas;
