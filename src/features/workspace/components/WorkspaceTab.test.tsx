import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FractalProject } from "@/lib/fractal/types";
import type { EditorGroup } from "../workspaceGroups";
import WorkspaceTab from "./WorkspaceTab";

const project: FractalProject = {
  name: "Test project",
  version: 2,
  rootPath: "/tmp/test-project",
  pages: [{ path: "notes.fractal.html", contentHash: "notes-hash", title: "Notes", text: "", links: [] }],
  folders: [],
  activePagePath: "notes.fractal.html",
  activePageSource: "",
  activePageLinks: [],
  activePageBacklinks: []
};

const group: EditorGroup = {
  id: "left",
  tabs: ["notes.fractal.html", "other.fractal.html"],
  activePath: "notes.fractal.html",
  history: ["notes.fractal.html"],
  historyIndex: 0
};

describe("workspace tab", () => {
  it("renders a page tab with its dirty state", () => {
    const element = WorkspaceTab({
      buffers: { "notes.fractal.html": { documentId: "amanite-document-test-notes", projectGeneration: 1, incarnation: 1, path: "notes.fractal.html", baseSource: "", source: "", title: "Notes", bodyHtml: "<p></p>", hasTitleHeading: false, links: [], backlinks: [], contentHash: "notes-hash", nativeDocumentParts: null, nativeEdits: {}, dirty: true, revision: 1, snapshotRevision: 0, savedRevision: 0, draftedRevision: 0, draftError: null, operation: null, error: null, conflict: false } },
      draggedTab: null,
      group,
      index: 0,
      onCloseTab: vi.fn(),
      onDragEnd: vi.fn(),
      onDragStart: vi.fn(),
      onDropTab: vi.fn(),
      onSelectTab: vi.fn(),
      onSplitTab: vi.fn(),
      path: "notes.fractal.html",
      project
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Notes");
    expect(html).toContain('aria-label="Unsaved"');
  });
});
