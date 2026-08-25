import { describe, expect, it, vi } from "vitest";
import type { FractalProject } from "@/lib/fractal/types";
import type { DocumentBuffers } from "@/features/workspace/documents/documentBuffers";
import { BOREALIS_TAB_ID, type WorkspaceGroups } from "@/features/workspace/workspaceGroups";
import type { AiToolCall } from "./client";
import { executeWorkspaceTool, type AiWorkspace, workspaceSystemPrompt } from "./workspaceTools";

function workspace(overrides: Partial<AiWorkspace> = {}): AiWorkspace {
  const project = {
    name: "Field notes",
    rootPath: "/projects/field-notes",
    folders: ["drafts"],
    pages: [
      {
        path: "drafts/day-one.fractal.html",
        contentHash: "saved-hash",
        kind: "native",
        title: "Day one",
        text: "Saved private page text",
        links: [],
        iframes: []
      }
    ],
    activePagePath: "drafts/day-one.fractal.html",
    activePageSource: null,
    activePageLinks: [],
    activePageBacklinks: [],
    activePageIframes: [],
    activePageIframeBacklinks: []
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
  return {
    project,
    groups,
    buffers: {},
    searchProject: vi.fn().mockResolvedValue([]),
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
});

describe("executeWorkspaceTool", () => {
  it("reads an unsaved editor buffer before the saved Fractal page", async () => {
    const buffers: DocumentBuffers = {
      "drafts/day-one.fractal.html": {
        path: "drafts/day-one.fractal.html",
        source: '<!doctype html><html><body><main data-fractal-document><p>Fresh unsaved thought</p></main></body></html>',
        links: [],
        backlinks: [],
        iframes: [],
        iframeBacklinks: [],
        contentHash: "saved-hash",
        dirty: true,
        revision: 1,
        operation: null,
        error: null,
        conflict: false
      }
    };
    const result = JSON.parse(await executeWorkspaceTool(
      call("fractal_read_page", { path: "drafts/day-one.fractal.html" }),
      workspace({ buffers })
    )) as Record<string, unknown>;
    expect(result.source).toBe("unsaved_buffer");
    expect(result.content).toBe("Fresh unsaved thought");
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
