import { useEffect, useState, type KeyboardEvent } from "react";
import type {
  FractalGraphPageLink,
  FractalNote,
  FractalPage,
  FractalPageLink
} from "@/lib/fractal/types";
import EditorCanvas from "./EditorCanvas";
import InspectorPanel from "./InspectorPanel";
import NoteContextMenu from "./NoteContextMenu";
import NotePopover from "./NotePopover";
import { useEditorLinkInteractions } from "./useEditorLinkInteractions";
import { useNoteInteractions } from "./useNoteInteractions";
import { useTagEditor } from "./useTagEditor";

type FractalEditorProps = {
  backlinks: FractalGraphPageLink[];
  bodyHtml: string;
  isBusy: boolean;
  isDirty: boolean;
  links: FractalPageLink[];
  notes: FractalNote[];
  outlinks: FractalGraphPageLink[];
  pages: FractalPage[];
  pagePath: string;
  summary?: string | null;
  tags: string[];
  title: string;
  onAddNote: (trigger: string, content: string) => void;
  onDeleteNote: (note: FractalNote) => void;
  onChangeBodyHtml: (bodyHtml: string) => void;
  onChangeSummary: (summary: string) => void;
  onChangeTags: (tags: string[]) => void;
  onChangeTitle: (title: string) => void;
  onNavigatePage: (pagePath: string) => void;
  onSave: () => void;
  onUpdateNote: (note: FractalNote, content: string) => void;
};

function FractalEditor({
  backlinks,
  bodyHtml,
  isBusy,
  links,
  notes,
  outlinks,
  pages,
  pagePath,
  summary,
  tags,
  title,
  onAddNote,
  onDeleteNote,
  onChangeBodyHtml,
  onChangeSummary,
  onChangeTags,
  onChangeTitle,
  onNavigatePage,
  onSave,
  onUpdateNote
}: FractalEditorProps) {
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const tagEditor = useTagEditor({ resetKey: pagePath, tags, onChangeTags });
  const noteInteractions = useNoteInteractions({
    resetKey: pagePath,
    onAddNote,
    onDeleteNote,
    onUpdateNote
  });
  const editorLinkInteractions = useEditorLinkInteractions({
    closeHoverPopover: noteInteractions.closeHoverPopover,
    links,
    notes,
    onNavigatePage,
    openNoteDetailAtAnchor: noteInteractions.openNoteDetailAtAnchor,
    pagePath,
    pages,
    showHoverPopover: noteInteractions.showHoverPopover,
    showNoteContextMenu: noteInteractions.showNoteContextMenu
  });

  useEffect(() => {
    setIsInspectorOpen(false);
  }, [pagePath]);

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div
      className={
        isInspectorOpen
          ? "fractal-editor rich-editor inspector-open"
          : "fractal-editor rich-editor"
      }
      onClickCapture={editorLinkInteractions.handleEditorClick}
      onContextMenu={editorLinkInteractions.handleEditorContextMenu}
      onKeyDown={handleEditorKeyDown}
      onMouseLeave={editorLinkInteractions.handleEditorMouseLeave}
      onMouseMove={editorLinkInteractions.handleEditorMouseMove}
    >
      <EditorCanvas
        bodyHtml={bodyHtml}
        isBusy={isBusy}
        isInspectorOpen={isInspectorOpen}
        noteInteractions={noteInteractions}
        notes={notes}
        pagePath={pagePath}
        summary={summary}
        tagEditor={tagEditor}
        tags={tags}
        title={title}
        onChangeBodyHtml={onChangeBodyHtml}
        onChangeSummary={onChangeSummary}
        onChangeTitle={onChangeTitle}
        onDeleteNote={onDeleteNote}
        onToggleInspector={() => setIsInspectorOpen((current) => !current)}
      />

      <NoteContextMenu
        noteMenu={noteInteractions.noteMenu}
        onAddNote={noteInteractions.handleAddNoteFromMenu}
      />

      <NotePopover
        isBusy={isBusy}
        notePopover={noteInteractions.notePopover}
        notePopoverEditorRef={noteInteractions.notePopoverEditorRef}
        onCancel={noteInteractions.cancelNotePopover}
        onCommit={noteInteractions.commitNotePopover}
        onDeleteNote={noteInteractions.deleteNoteFromPopover}
        onKeyDown={noteInteractions.handleNotePopoverKeyDown}
        onOpenNoteEditor={noteInteractions.openNoteEditor}
        onUpdateDraft={noteInteractions.updateNotePopoverDraft}
      />

      <InspectorPanel backlinks={backlinks} links={links} notes={notes} outlinks={outlinks} />
    </div>
  );
}

export default FractalEditor;
