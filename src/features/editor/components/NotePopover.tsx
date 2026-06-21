import type { FractalNote } from "@/lib/fractal/types";
import type { KeyboardEvent, RefObject } from "react";
import { pagePreviewText, truncateNotePreview } from "./editorText";
import type { NotePopoverState } from "./editorTypes";

type NotePopoverProps = {
  isBusy: boolean;
  notePopover: NotePopoverState | null;
  notePopoverEditorRef: RefObject<HTMLTextAreaElement | null>;
  onCancel: () => void;
  onCommit: () => void;
  onDeleteNote: (note: FractalNote) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onOpenNoteEditor: (note: FractalNote) => void;
  onUpdateDraft: (draft: string) => void;
};

function NotePopover({
  isBusy,
  notePopover,
  notePopoverEditorRef,
  onCancel,
  onCommit,
  onDeleteNote,
  onKeyDown,
  onOpenNoteEditor,
  onUpdateDraft
}: NotePopoverProps) {
  if (!notePopover) {
    return null;
  }

  return (
    <div
      aria-label={
        notePopover.kind === "page-preview"
          ? "Page preview"
          : notePopover.kind === "note-preview"
            ? "Note preview"
            : "Note dialog"
      }
      className={
        notePopover.kind === "note-preview" || notePopover.kind === "page-preview"
          ? "note-popover preview"
          : notePopover.kind === "note-detail"
            ? "note-popover detail"
            : "note-popover editor"
      }
      onClick={(event) => event.stopPropagation()}
      onMouseMove={(event) => event.stopPropagation()}
      role={
        notePopover.kind === "note-preview" || notePopover.kind === "page-preview"
          ? "tooltip"
          : "dialog"
      }
      style={{ left: notePopover.x, top: notePopover.y }}
    >
      {notePopover.kind === "note-preview" ? (
        <>
          <div className="note-popover-kicker">Note preview</div>
          <strong title={notePopover.note.label}>{notePopover.note.label}</strong>
          <p>{truncateNotePreview(notePopover.note.text)}</p>
          <small>Click to expand note.</small>
        </>
      ) : notePopover.kind === "page-preview" ? (
        <>
          <div className="note-popover-kicker">Page preview</div>
          <strong title={notePopover.page.path}>{notePopover.page.name}</strong>
          <p>{pagePreviewText(notePopover.page)}</p>
          <small>{notePopover.page.path}</small>
        </>
      ) : notePopover.kind === "note-detail" ? (
        <>
          <div className="note-popover-heading">
            <div>
              <div className="note-popover-kicker">Note</div>
              <strong title={notePopover.note.label}>{notePopover.note.label}</strong>
            </div>
            <div className="note-popover-icon-actions" aria-label="Note actions">
              <button
                aria-label={`Edit note for ${notePopover.note.label}`}
                disabled={isBusy}
                onClick={() => onOpenNoteEditor(notePopover.note)}
                title="Edit note"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M2.5 11.6 2 14l2.4-.5 8.2-8.2-1.9-1.9-8.2 8.2Z" />
                  <path d="m9.8 4.3 1.9 1.9" />
                </svg>
              </button>
              <button
                aria-label={`Delete note for ${notePopover.note.label}`}
                className="danger"
                disabled={isBusy}
                onClick={() => onDeleteNote(notePopover.note)}
                title="Delete note"
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16">
                  <path d="M3.5 5h9" />
                  <path d="M6.2 5V3.4h3.6V5" />
                  <path d="M4.5 5.5 5.1 14h5.8l.6-8.5" />
                  <path d="M7 7.4v4.2" />
                  <path d="M9 7.4v4.2" />
                </svg>
              </button>
              <button aria-label="Close note" onClick={onCancel} title="Close" type="button">
                ×
              </button>
            </div>
          </div>
          <p className="note-popover-full-text">
            {notePopover.note.text || "No note body yet."}
          </p>
        </>
      ) : (
        <>
          <div className="note-popover-kicker">
            {notePopover.kind === "create" ? "New note" : "Edit note"}
          </div>
          <strong
            title={notePopover.kind === "create" ? notePopover.trigger : notePopover.note.label}
          >
            {notePopover.kind === "create" ? notePopover.trigger : notePopover.note.label}
          </strong>
          <textarea
            aria-label={
              notePopover.kind === "create"
                ? `New note body for ${notePopover.trigger}`
                : `Note body for ${notePopover.note.label}`
            }
            disabled={isBusy}
            onChange={(event) => onUpdateDraft(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Write the note body..."
            ref={notePopoverEditorRef}
            rows={4}
            value={notePopover.draft}
          />
          <div className="note-popover-actions">
            <button className="ghost-action" onClick={onCancel} type="button">
              Cancel
            </button>
            <button
              className="primary-action"
              disabled={isBusy}
              onClick={onCommit}
              type="button"
            >
              {notePopover.kind === "create" ? "Create note" : "Save note"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default NotePopover;
