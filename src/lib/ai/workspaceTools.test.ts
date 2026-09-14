import { describe, expect, it } from "vitest";
import type { FractalProject } from "@/lib/fractal/types";
import type { DocumentBuffers } from "@/features/workspace/documents/documentBuffers";
import { BOREALIS_TAB_ID, type WorkspaceGroups } from "@/features/workspace/workspaceGroups";
import { folderTabId } from "@/features/workspace/folderTabs";
import type { AiToolCall } from "./client";
import { executeWorkspaceTool, type AiWorkspace, workspaceSystemPrompt } from "./workspaceTools";
import { DocumentQueryIndex } from "@/features/workspace/documentQueryIndex";

function workspace(overrides: Partial<AiWorkspace> = {}): AiWorkspace {
  const project = {
    name: "Field notes",
    version: 2,
    rootPath: "/projects/field-notes",
    folders: [
      { path: "", title: "Field notes", order: null, children: [{ name: "drafts", kind: "folder", status: "present" }], issues: [] },
      { path: "drafts", title: "Drafts", order: null, children: [], issues: [] }
    ],
    pages: [
      {
        path: "drafts/day-one.fractal.html",
        contentHash: "saved-hash",
        title: "Day one",
        text: "Saved private page text",
        links: []
      }
    ],
    activePagePath: "drafts/day-one.fractal.html",
    activePageSource: null,
    activePageLinks: [],
    activePageBacklinks: []
  } as FractalProject;
  const groups: WorkspaceGroups = {
    activeGroupId: "left",
    left: {
      id: "left",
      tabs: ["drafts/day-one.fractal.html"],
      activePath: "drafts/day-one.fractal.html",
      history: ["drafts/day-one.fractal.html"],
      historyIndex: 0
    },
    right: null
  };
  const documentQueries = new DocumentQueryIndex(project.pages);
  return {
    project,
    groups,
    buffers: {},
    documentQueries,
    ...overrides
  };
}

function call(name: string, args: Record<string, unknown>): AiToolCall {
  return {
    id: "call-1",
    type: "function",
    function: { name, arguments: JSON.stringify(args) }
  };
}

describe("workspaceSystemPrompt", () => {
  it("includes workspace location without including page contents or the absolute root", () => {
    const prompt = workspaceSystemPrompt(workspace());
    expect(prompt).toContain("drafts/day-one.fractal.html");
    expect(prompt).toContain('"focused":true');
    expect(prompt).not.toContain("Saved private page text");
    expect(prompt).not.toContain("/projects/field-notes");
  });

  it("does not present the Borealis UI tab to the model as a project page", () => {
    const current = workspace();
    const groups: WorkspaceGroups = {
      ...current.groups,
      left: {
        ...current.groups.left,
        tabs: ["drafts/day-one.fractal.html", BOREALIS_TAB_ID],
        activePath: BOREALIS_TAB_ID,
        history: ["drafts/day-one.fractal.html", BOREALIS_TAB_ID],
        historyIndex: 1
      }
    };
    const prompt = workspaceSystemPrompt(workspace({ groups }));

    expect(prompt).not.toContain(BOREALIS_TAB_ID);
    expect(prompt).toContain('"activePage":null');
  });

  it("does not present folder tabs as project pages", () => {
    const current = workspace();
    const folderTab = folderTabId("drafts");
    const groups: WorkspaceGroups = {
      ...current.groups,
      left: {
        ...current.groups.left,
        tabs: ["drafts/day-one.fractal.html", folderTab],
        activePath: folderTab,
        history: ["drafts/day-one.fractal.html", folderTab],
        historyIndex: 1
      }
    };
    const prompt = workspaceSystemPrompt(workspace({ groups }));

    expect(prompt).not.toContain(folderTab);
    expect(prompt).toContain('"activePage":null');
    expect(prompt).toContain('"activeFolder":{"path":"drafts","title":"Drafts"}');
  });
});

describe("executeWorkspaceTool", () => {
  it("reads an unsaved editor buffer before the saved Fractal page", async () => {
    const buffers: DocumentBuffers = {
      "drafts/day-one.fractal.html": {
        documentId: "amanite-document-test-day-one",
        projectGeneration: 1,
        path: "drafts/day-one.fractal.html",
        baseSource: '<!doctype html><html><body><main data-fractal-document><p>Fresh unsaved thought</p></main></body></html>',
        source: '<!doctype html><html><body><main data-fractal-document><p>Fresh unsaved thought</p></main></body></html>',
        title: "Day one",
        bodyHtml: "<p>Fresh unsaved thought</p>",
        hasTitleHeading: false,
        links: [],
        backlinks: [],
        contentHash: "saved-hash",
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
        conflict: false
      }
    };
    const documentQueries = new DocumentQueryIndex(workspace().project.pages);
    documentQueries.setLiveDocument({
      documentId: "amanite-document-test-day-one",
      dirty: true,
      links: [],
      model: {
        counts: { characters: 19, paragraphs: 1, readingMinutes: 1, words: 3 },
        outline: [],
        revision: 1,
        text: "Fresh unsaved thought"
      },
      path: "drafts/day-one.fractal.html",
      title: "Day one"
    });
    const result = JSON.parse(await executeWorkspaceTool(
      call("fractal_read_page", { path: "drafts/day-one.fractal.html" }),
      workspace({ buffers, documentQueries })
    )) as Record<string, unknown>;
    expect(result.source).toBe("unsaved_buffer");
    expect(result.content).toBe("Fresh unsaved thought");
  });

  it("uses the shared live query index for search and bounded reads", async () => {
    const current = workspace();
    const documentQueries = new DocumentQueryIndex(current.project.pages);
    documentQueries.setLiveDocument({
      documentId: "amanite-document-test-day-one",
      dirty: true,
      links: [],
      model: {
        counts: { characters: 18, paragraphs: 1, readingMinutes: 1, words: 3 },
        outline: [],
        revision: 4,
        text: "Fresh live thought"
      },
      path: "drafts/day-one.fractal.html",
      title: "Live day one"
    });

    const withQueries = workspace({ documentQueries });
    const search = JSON.parse(await executeWorkspaceTool(call("fractal_search", { query: "live" }), withQueries)) as { results: Array<Record<string, unknown>> };
    const read = JSON.parse(await executeWorkspaceTool(call("fractal_read_page", { path: "drafts/day-one.fractal.html", limit: 5 }), withQueries)) as Record<string, unknown>;

    expect(search.results[0]).toMatchObject({ freshness: "live", path: "drafts/day-one.fractal.html", revision: 4 });
    expect(read).toMatchObject({ content: "Fresh", freshness: "live", nextOffset: 5, title: "Live day one" });
  });

  it("uses the saved Page text when the page has no open buffer", async () => {
    const result = JSON.parse(await executeWorkspaceTool(
      call("fractal_read_page", { path: "drafts/day-one.fractal.html" }),
      workspace()
    )) as Record<string, unknown>;
    expect(result.source).toBe("saved_page");
    expect(result.content).toBe("Saved private page text");
  });

  it("returns tool errors as data so the model can recover", async () => {
    const result = JSON.parse(await executeWorkspaceTool(
      call("fractal_read_page", { path: "missing.fractal.html" }),
      workspace()
    )) as Record<string, unknown>;
    expect(result.error).toBe("No page exists at missing.fractal.html.");
  });
});
