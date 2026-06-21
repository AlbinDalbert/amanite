import type {
  FractalNote,
  FractalPage,
  FractalPageLink
} from "@/lib/fractal/types";
import type { MouseEvent } from "react";
import {
  NOTE_CONTEXT_MENU_HEIGHT,
  NOTE_CONTEXT_MENU_WIDTH,
  NOTE_EDITOR_POPOVER_HEIGHT,
  NOTE_POPOVER_WIDTH,
  NOTE_PREVIEW_POPOVER_HEIGHT,
  positionFloatingPoint,
  positionFloatingPopover,
  selectionAnchorRect
} from "./editorGeometry";
import { linkForAnchor, pageForAnchor, resolvePageHref } from "./editorLinks";

type FloatingPosition = {
  x: number;
  y: number;
};

type UseEditorLinkInteractionsArgs = {
  links: FractalPageLink[];
  notes: FractalNote[];
  pages: FractalPage[];
  pagePath: string;
  onNavigatePage: (pagePath: string) => void;
  closeHoverPopover: () => void;
  openNoteDetailAtAnchor: (note: FractalNote, anchor: HTMLAnchorElement) => void;
  showHoverPopover: (target: {
    note?: FractalNote | null;
    page?: FractalPage | null;
    position: FloatingPosition;
  }) => void;
  showNoteContextMenu: (state: {
    popoverPosition: FloatingPosition;
    trigger: string;
    menuPosition: FloatingPosition;
  }) => void;
};

export function useEditorLinkInteractions({
  links,
  notes,
  pages,
  pagePath,
  onNavigatePage,
  closeHoverPopover,
  openNoteDetailAtAnchor,
  showHoverPopover,
  showNoteContextMenu
}: UseEditorLinkInteractionsArgs) {
  function noteFromAnchor(anchor: HTMLAnchorElement) {
    const targetNote = linkForAnchor(anchor, links)?.targetNote;

    if (!targetNote) {
      return null;
    }

    return notes.find((note) => note.id === targetNote) ?? null;
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

    showHoverPopover({ note, page, position });
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

    showNoteContextMenu({
      menuPosition,
      popoverPosition,
      trigger: selectedText
    });
  }

  return {
    handleEditorClick,
    handleEditorContextMenu,
    handleEditorMouseLeave,
    handleEditorMouseMove
  };
}

export type EditorLinkInteractionsController = ReturnType<typeof useEditorLinkInteractions>;
