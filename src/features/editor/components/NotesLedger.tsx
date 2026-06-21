import type { FractalNote } from "@/lib/fractal/types";
import type { KeyboardEvent } from "react";

type NotesLedgerProps = {
  editingNoteId: string | null;
  isBusy: boolean;
  noteDraft: string;
  notes: FractalNote[];
  onCancelEditingNote: () => void;
  onChangeNoteDraft: (draft: string) => void;
  onCommitNoteEdit: (note: FractalNote) => void;
  onDeleteNote: (note: FractalNote) => void;
  onNoteDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, note: FractalNote) => void;
  onStartEditingNote: (note: FractalNote) => void;
};

function NotesLedger({
  editingNoteId,
  isBusy,
  noteDraft,
  notes,
  onCancelEditingNote,
  onChangeNoteDraft,
  onCommitNoteEdit,
  onDeleteNote,
  onNoteDraftKeyDown,
  onStartEditingNote
}: NotesLedgerProps) {
  return (
    <section className="rich-notes-ledger" aria-label="Internal notes">
      <div className="rich-notes-header">
        <span>Internal notes</span>
        <small>{notes.length}</small>
      </div>
      {notes.length > 0 ? (
        <ol className="rich-note-list">
          {notes.map((note) => {
            const isEditingNote = editingNoteId === note.id;

            return (
              <li
                className={isEditingNote ? "rich-note-card editing" : "rich-note-card"}
                data-note-id={note.id}
                id={note.id}
                key={note.id}
              >
                <div className="rich-note-card-header">
                  <strong>{note.label}</strong>
                  <div className="rich-note-actions">
                    {isEditingNote ? (
                      <>
                        <button
                          disabled={isBusy}
                          onClick={() => onCommitNoteEdit(note)}
                          type="button"
                        >
                          Save
                        </button>
                        <button onClick={onCancelEditingNote} type="button">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          disabled={isBusy}
                          onClick={() => onStartEditingNote(note)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="danger"
                          disabled={isBusy}
                          onClick={() => onDeleteNote(note)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingNote ? (
                  <textarea
                    aria-label={`Note body for ${note.label}`}
                    className="rich-note-editor"
                    onChange={(event) => onChangeNoteDraft(event.currentTarget.value)}
                    onKeyDown={(event) => onNoteDraftKeyDown(event, note)}
                    placeholder="Write the note body..."
                    rows={3}
                    value={noteDraft}
                  />
                ) : (
                  <p>{note.text || "No note body yet."}</p>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rich-notes-empty">
          Select text in the body, right-click, then add a note.
        </p>
      )}
    </section>
  );
}

export default NotesLedger;
