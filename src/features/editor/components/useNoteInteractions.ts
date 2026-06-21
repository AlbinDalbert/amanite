import type { FractalNote, FractalPage } from "@/lib/fractal/types";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  NOTE_DETAIL_POPOVER_HEIGHT,
  positionFloatingPopover
} from "./editorGeometry";
import type { NoteContextMenuState, NotePopoverState } from "./editorTypes";

type FloatingPosition = {
  x: number;
  y: number;
};

type UseNoteInteractionsArgs = {
  resetKey: string;
  onAddNote: (trigger: string, content: string) => void;
  onDeleteNote: (note: FractalNote) => void;
  onUpdateNote: (note: FractalNote, content: string) => void;
};

export function useNoteInteractions({
  resetKey,
  onAddNote,
  onDeleteNote,
  onUpdateNote
}: UseNoteInteractionsArgs) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMenu, setNoteMenu] = useState<NoteContextMenuState | null>(null);
  const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null);
  const notePopoverEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditingNoteId(null);
    setNoteDraft("");
    setNoteMenu(null);
    setNotePopover(null);
  }, [resetKey]);

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

  function showHoverPopover({
    note,
    page,
    position
  }: {
    note?: FractalNote | null;
    page?: FractalPage | null;
    position: FloatingPosition;
  }) {
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

  function showNoteContextMenu({
    popoverPosition,
    trigger,
    menuPosition
  }: {
    popoverPosition: FloatingPosition;
    trigger: string;
    menuPosition: FloatingPosition;
  }) {
    setNoteMenu({
      popoverX: popoverPosition.x,
      popoverY: popoverPosition.y,
      trigger,
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

  return {
    cancelEditingNote,
    cancelNotePopover,
    closeHoverPopover,
    commitNoteEdit,
    commitNotePopover,
    deleteNoteFromPopover,
    editingNoteId,
    handleAddNoteFromMenu,
    handleNoteDraftKeyDown,
    handleNotePopoverKeyDown,
    noteDraft,
    noteMenu,
    notePopover,
    notePopoverEditorRef,
    openNoteDetailAtAnchor,
    openNoteEditor,
    setNoteDraft,
    showHoverPopover,
    showNoteContextMenu,
    startEditingNote,
    updateNotePopoverDraft
  };
}

export type NoteInteractionsController = ReturnType<typeof useNoteInteractions>;
