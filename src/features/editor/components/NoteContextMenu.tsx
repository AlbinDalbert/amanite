import type { NoteContextMenuState } from "./editorTypes";

type NoteContextMenuProps = {
  noteMenu: NoteContextMenuState | null;
  onAddNote: () => void;
};

function NoteContextMenu({ noteMenu, onAddNote }: NoteContextMenuProps) {
  if (!noteMenu) {
    return null;
  }

  return (
    <div
      className="editor-context-menu"
      onClick={(event) => event.stopPropagation()}
      role="menu"
      style={{ left: noteMenu.x, top: noteMenu.y }}
    >
      <p title={noteMenu.trigger}>{noteMenu.trigger}</p>
      <button onClick={onAddNote} role="menuitem" type="button">
        Add note
      </button>
    </div>
  );
}

export default NoteContextMenu;
