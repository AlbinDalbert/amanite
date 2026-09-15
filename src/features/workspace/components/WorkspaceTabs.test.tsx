import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FractalProject } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import { folderTabId } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroup } from "../workspaceGroups";
import WorkspaceTabs from "./WorkspaceTabs";

const project: FractalProject = {
  name: "Test project",
  version: 2,
  rootPath: "/tmp/test-project",
  pages: [{ path: "notes.fractal.html", contentHash: "notes-hash", title: "Notes" }],
  folders: [{ path: "drafts", title: "Drafts", children: [], issues: [] }],
  activePagePath: "notes.fractal.html",
  activePageSource: "",
  activePageLinks: [],
  activePageBacklinks: []
};

const buffer: DocumentBuffer = {
  documentId: "amanite-document-test-notes",
  projectGeneration: 1,
  incarnation: 1,
  path: "notes.fractal.html",
  baseSource: "",
  source: "",
  title: "Notes",
  bodyHtml: "<p></p>",
  hasTitleHeading: false,
  links: [],
  backlinks: [],
  contentHash: "notes-hash",
  nativeDocumentParts: null,
  nativeEdits: {},
  dirty: true,
  revision: 1,
  snapshotRevision: 0,
  savedRevision: 0,
  draftedRevision: 0,
  draftError: null,
  operation: null,
  error: null,
  conflict: true
};

function group(): EditorGroup {
  const tabs = [BOREALIS_TAB_ID, "notes.fractal.html", folderTabId("drafts")];
  return { id: "left", tabs, activePath: "notes.fractal.html", history: tabs, historyIndex: 1 };
}

function tabProps() {
  return {
    buffers: { [buffer.path]: buffer },
    draggedTab: null,
    focused: true,
    group: group(),
    project,
    onActivate: vi.fn(),
    onCloseGroup: vi.fn(),
    onCloseTab: vi.fn(),
    onDragEnd: vi.fn(),
    onDragStart: vi.fn(),
    onDropTab: vi.fn(),
    onSelectTab: vi.fn(),
    onSplitTab: vi.fn()
  };
}

describe("workspace tabs", () => {
  it("renders page, folder, and Borealis tabs with their state", () => {
    const html = renderToStaticMarkup(<WorkspaceTabs {...tabProps()} />);

    expect(html).toContain("Borealis");
    expect(html).toContain("Notes");
    expect(html).toContain("Drafts");
    expect(html).toContain("Changed on disk");
    expect(html).toContain("Close editor group");
  });
});
