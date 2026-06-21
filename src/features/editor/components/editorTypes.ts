import type { FractalNote, FractalPage } from "@/lib/fractal/types";

export type NoteContextMenuState = {
  trigger: string;
  popoverX: number;
  popoverY: number;
  x: number;
  y: number;
};

export type NotePopoverState =
  | {
      kind: "note-preview";
      note: FractalNote;
      x: number;
      y: number;
    }
  | {
      kind: "note-detail";
      note: FractalNote;
      x: number;
      y: number;
    }
  | {
      kind: "page-preview";
      page: FractalPage;
      x: number;
      y: number;
    }
  | {
      draft: string;
      kind: "create";
      trigger: string;
      x: number;
      y: number;
    }
  | {
      draft: string;
      kind: "edit";
      note: FractalNote;
      x: number;
      y: number;
    };
