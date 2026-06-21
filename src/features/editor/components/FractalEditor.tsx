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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import type {
  FractalGraphPageLink,
  FractalNote,
  FractalPage,
  FractalPageLink
} from "@/lib/fractal/types";
import InspectorPanel from "./InspectorPanel";
import NoteContextMenu from "./NoteContextMenu";
import NotePopover from "./NotePopover";
import NotesLedger from "./NotesLedger";
import PageMetadataEditor from "./PageMetadataEditor";
import {
  NOTE_CONTEXT_MENU_HEIGHT,
  NOTE_CONTEXT_MENU_WIDTH,
  NOTE_DETAIL_POPOVER_HEIGHT,
  NOTE_EDITOR_POPOVER_HEIGHT,
  NOTE_POPOVER_WIDTH,
  NOTE_PREVIEW_POPOVER_HEIGHT,
  positionFloatingPoint,
  positionFloatingPopover,
  selectionAnchorRect
} from "./editorGeometry";
import { linkForAnchor, pageForAnchor, resolvePageHref } from "./editorLinks";
import { editorLexicalTheme } from "./editorLexicalTheme";
import { tagsFromDraft } from "./editorText";
import type { NoteContextMenuState, NotePopoverState } from "./editorTypes";
import EditorToolbar from "./plugins/EditorToolbar";
import HtmlBridgePlugin from "./plugins/HtmlBridgePlugin";

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
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMenu, setNoteMenu] = useState<NoteContextMenuState | null>(null);
  const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const notePopoverEditorRef = useRef<HTMLTextAreaElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
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

  useEffect(() => {
    setEditingNoteId(null);
    setIsAddingTag(false);
    setIsInspectorOpen(false);
    setNoteDraft("");
    setTagDraft("");
    setNoteMenu(null);
    setNotePopover(null);
  }, [pagePath]);

  useEffect(() => {
    if (isAddingTag) {
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }, [isAddingTag]);

  useEffect(() => {
    if (notePopover?.kind === "create" || notePopover?.kind === "edit") {
      requestAnimationFrame(() => notePopoverEditorRef.current?.focus());
    }
  }, [notePopover?.kind]);

  useEffect(() => {
    if (!noteMenu) {
      return;
    }

    function closeMenu() {
      setNoteMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [noteMenu]);

  function commitTagDraft() {
    const nextTags = tagsFromDraft(tagDraft);
    const nextTag = nextTags[0];

    if (nextTag && !tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      onChangeTags([...tags, nextTag]);
    }

    setTagDraft("");
    setIsAddingTag(false);
  }

  function removeTag(tagToRemove: string) {
    onChangeTags(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
      return;
    }

    if (event.key === "Escape") {
      setTagDraft("");
      setIsAddingTag(false);
    }
  }

  function noteFromAnchor(anchor: HTMLAnchorElement) {
    const targetNote = linkForAnchor(anchor, links)?.targetNote;

    if (!targetNote) {
      return null;
    }

    return notes.find((note) => note.id === targetNote) ?? null;
  }

  function openNoteDetailAtAnchor(note: FractalNote, anchor: HTMLAnchorElement) {
    const position = positionFloatingPopover(
      anchor.getBoundingClientRect(),
      NOTE_DETAIL_POPOVER_HEIGHT
    );

    setNotePopover({
      kind: "note-detail",
      note,
      ...position
    });
  }

  function openNoteEditor(note: FractalNote) {
    setNotePopover((currentPopover) => ({
      draft: note.text,
      kind: "edit",
      note,
      x: currentPopover?.x ?? 16,
      y: currentPopover?.y ?? 16
    }));
  }

  function deleteNoteFromPopover(note: FractalNote) {
    onDeleteNote(note);
    setNotePopover(null);
  }

  function closeHoverPopover() {
    setNotePopover((currentPopover) =>
      currentPopover?.kind === "note-preview" || currentPopover?.kind === "page-preview"
        ? null
        : currentPopover
    );
  }

  function handleEditorMouseMove(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");

    if (!anchor) {
      closeHoverPopover();
      return;
    }

    const note = noteFromAnchor(anchor);
    const page = note ? null : pageForAnchor(anchor, links, pages, pagePath);

    if (!note && !page) {
      closeHoverPopover();
      return;
    }

    const position = positionFloatingPopover(
      anchor.getBoundingClientRect(),
      NOTE_PREVIEW_POPOVER_HEIGHT
    );

    setNotePopover((currentPopover) => {
      if (
        currentPopover &&
        currentPopover.kind !== "note-preview" &&
        currentPopover.kind !== "page-preview"
      ) {
        return currentPopover;
      }

      if (
        note &&
        currentPopover?.kind === "note-preview" &&
        currentPopover.note.id === note.id &&
        currentPopover.x === position.x &&
        currentPopover.y === position.y
      ) {
        return currentPopover;
      }

      if (
        page &&
        currentPopover?.kind === "page-preview" &&
        currentPopover.page.path === page.path &&
        currentPopover.x === position.x &&
        currentPopover.y === position.y
      ) {
        return currentPopover;
      }

      return note
        ? {
            kind: "note-preview",
            note,
            ...position
          }
        : {
            kind: "page-preview",
            page: page!,
            ...position
          };
    });
  }

  function handleEditorMouseLeave() {
    closeHoverPopover();
  }

  function handleEditorClick(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");

    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }

    if (href.startsWith("#")) {
      const note = noteFromAnchor(anchor);

      if (note) {
        event.preventDefault();
        openNoteDetailAtAnchor(note, anchor);
        return;
      }

      const noteId = linkForAnchor(anchor, links)?.targetNote;
      const noteElement = noteId
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-note-id]")).find(
            (element) => element.dataset.noteId === noteId
          )
        : null;

      if (noteElement) {
        event.preventDefault();
        noteElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      return;
    }

    const resolvedPagePath = resolvePageHref(pagePath, href);
    const nextPagePath = linkForAnchor(anchor, links)?.targetPage ?? resolvedPagePath;

    if (nextPagePath && pages.some((page) => page.path === nextPagePath)) {
      event.preventDefault();
      onNavigatePage(nextPagePath);
    }
  }

  function handleEditorContextMenu(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;

    if (!target?.closest(".rich-content-editable")) {
      return;
    }

    const selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!selectedText) {
      return;
    }

    event.preventDefault();
    closeHoverPopover();

    const menuPosition = positionFloatingPoint(
      event.clientX,
      event.clientY,
      NOTE_CONTEXT_MENU_WIDTH,
      NOTE_CONTEXT_MENU_HEIGHT
    );
    const selectionRect = selectionAnchorRect();
    const popoverPosition = selectionRect
      ? positionFloatingPopover(selectionRect, NOTE_EDITOR_POPOVER_HEIGHT)
      : positionFloatingPoint(
          event.clientX,
          event.clientY,
          NOTE_POPOVER_WIDTH,
          NOTE_EDITOR_POPOVER_HEIGHT
        );

    setNoteMenu({
      popoverX: popoverPosition.x,
      popoverY: popoverPosition.y,
      trigger: selectedText,
      ...menuPosition
    });
  }

  function handleAddNoteFromMenu() {
    if (!noteMenu) {
      return;
    }

    setNotePopover({
      draft: "",
      kind: "create",
      trigger: noteMenu.trigger,
      x: noteMenu.popoverX,
      y: noteMenu.popoverY
    });
    setNoteMenu(null);
  }

  function cancelNotePopover() {
    setNotePopover(null);
  }

  function updateNotePopoverDraft(draft: string) {
    setNotePopover((currentPopover) => {
      if (
        !currentPopover ||
        (currentPopover.kind !== "create" && currentPopover.kind !== "edit")
      ) {
        return currentPopover;
      }

      return {
        ...currentPopover,
        draft
      };
    });
  }

  function commitNotePopover() {
    if (!notePopover || (notePopover.kind !== "create" && notePopover.kind !== "edit")) {
      return;
    }

    if (notePopover.kind === "create") {
      onAddNote(notePopover.trigger, notePopover.draft);
    } else {
      onUpdateNote(notePopover.note, notePopover.draft);
    }

    setNotePopover(null);
  }

  function handleNotePopoverKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitNotePopover();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelNotePopover();
    }
  }

  function startEditingNote(note: FractalNote) {
    setEditingNoteId(note.id);
    setNoteDraft(note.text);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setNoteDraft("");
  }

  function commitNoteEdit(note: FractalNote) {
    onUpdateNote(note, noteDraft);
    cancelEditingNote();
  }

  function handleNoteDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, note: FractalNote) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitNoteEdit(note);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingNote();
    }
  }

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
      onClickCapture={handleEditorClick}
      onContextMenu={handleEditorContextMenu}
      onKeyDown={handleEditorKeyDown}
      onMouseLeave={handleEditorMouseLeave}
      onMouseMove={handleEditorMouseMove}
    >
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
            onClick={() => setIsInspectorOpen((current) => !current)}
            type="button"
          >
            {isInspectorOpen ? "Hide context" : "Inspect"}
          </button>

          <article className="rich-page-canvas">
            <div className="rich-page-column">
              <PageMetadataEditor
                isAddingTag={isAddingTag}
                pagePath={pagePath}
                summary={summary}
                tagDraft={tagDraft}
                tagInputRef={tagInputRef}
                tags={tags}
                title={title}
                onChangeSummary={onChangeSummary}
                onChangeTagDraft={setTagDraft}
                onChangeTitle={onChangeTitle}
                onCommitTagDraft={commitTagDraft}
                onRemoveTag={removeTag}
                onStartAddingTag={() => setIsAddingTag(true)}
                onTagInputKeyDown={handleTagInputKeyDown}
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
                editingNoteId={editingNoteId}
                isBusy={isBusy}
                noteDraft={noteDraft}
                notes={notes}
                onCancelEditingNote={cancelEditingNote}
                onChangeNoteDraft={setNoteDraft}
                onCommitNoteEdit={commitNoteEdit}
                onDeleteNote={onDeleteNote}
                onNoteDraftKeyDown={handleNoteDraftKeyDown}
                onStartEditingNote={startEditingNote}
              />
            </div>
          </article>
        </LexicalComposer>
      </section>

      <NoteContextMenu noteMenu={noteMenu} onAddNote={handleAddNoteFromMenu} />

      <NotePopover
        isBusy={isBusy}
        notePopover={notePopover}
        notePopoverEditorRef={notePopoverEditorRef}
        onCancel={cancelNotePopover}
        onCommit={commitNotePopover}
        onDeleteNote={deleteNoteFromPopover}
        onKeyDown={handleNotePopoverKeyDown}
        onOpenNoteEditor={openNoteEditor}
        onUpdateDraft={updateNotePopoverDraft}
      />

      <InspectorPanel backlinks={backlinks} links={links} notes={notes} outlinks={outlinks} />
    </div>
  );
}

export default FractalEditor;
