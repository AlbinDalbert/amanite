import { describe, expect, it } from "vitest";
import { BOREALIS_TAB_ID } from "../workspaceGroups";
import { folderTabId } from "../folderTabs";
import { isDocumentWaitingForBuffer } from "./EditorGroupPane";

describe("document loading preview", () => {
  it("remains visible while an active document is waiting for its buffer", () => {
    expect(isDocumentWaitingForBuffer("notes.fractal.html", false)).toBe(true);
  });

  it("stops after the buffer or an error arrives", () => {
    expect(isDocumentWaitingForBuffer("notes.fractal.html", true)).toBe(false);
    expect(isDocumentWaitingForBuffer("notes.fractal.html", false, "Could not read page")).toBe(false);
  });

  it("does not replace genuine empty or Borealis states", () => {
    expect(isDocumentWaitingForBuffer(null, false)).toBe(false);
    expect(isDocumentWaitingForBuffer(BOREALIS_TAB_ID, false)).toBe(false);
    expect(isDocumentWaitingForBuffer(folderTabId("drafts"), false)).toBe(false);
  });
});
