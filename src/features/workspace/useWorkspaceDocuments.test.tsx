import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { FractalProject } from "@/lib/fractal/types";
import { useWorkspaceDocuments } from "./useWorkspaceDocuments";

vi.mock("./documents/documentDraftRecovery", () => ({ resolveDocumentDraft: vi.fn(async ({ source }: { source: string }) => ({ source, dirty: false, revision: 0, draftedRevision: 0 })) }));

it("does not parse the opening document again when typing publishes a revision", async () => {
  const project: FractalProject = { name: "Test", version: 2, rootPath: "/tmp/typing-parse", pages: [], folders: [], activePagePath: "notes.fractal.html", activePageSource: '<main data-fractal-document><p>Notes</p></main>', activePageContentHash: "base", activePageLinks: [], activePageBacklinks: [] };
  let documents!: ReturnType<typeof useWorkspaceDocuments>;
  const onProjectSnapshot = vi.fn();
  const onDocumentPathChange = vi.fn();
  const onRequestConfirmation = vi.fn(async () => false);
  function Harness() {
    documents = useWorkspaceDocuments({ autoSave: false, initialProject: project, onProjectSnapshot, onDocumentPathChange, onRequestConfirmation });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
  try {
    await act(async () => documents.markRevision("notes.fractal.html", 1));
    expect(documents.buffers["notes.fractal.html"].revision).toBe(1);
    expect(parse).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    parse.mockRestore();
  }
});

it("keeps a real conflict visible while typing and recovery snapshots continue", async () => {
  const { fractalClient } = await import("@/lib/fractal/client");
  vi.useFakeTimers();
  const project: FractalProject = { name: "Test", version: 2, rootPath: "/tmp/typing-conflict", pages: [], folders: [], activePagePath: "notes.fractal.html", activePageSource: '<main data-fractal-document><p>Notes</p></main>', activePageContentHash: "base", activePageLinks: [], activePageBacklinks: [] };
  const poll = vi.spyOn(fractalClient, "pageContentStates").mockResolvedValue([{ path: "notes.fractal.html", contentHash: "external" }]);
  let documents!: ReturnType<typeof useWorkspaceDocuments>;
  function Harness() {
    documents = useWorkspaceDocuments({ autoSave: false, initialProject: project, onProjectSnapshot: vi.fn(), onDocumentPathChange: vi.fn(), onRequestConfirmation: vi.fn(async () => false) });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const conflicted = documents.buffers["notes.fractal.html"];
    expect(conflicted.conflict).toBe(true);
    expect(conflicted.error).toContain("changed on disk");
    await act(async () => documents.markRevision(conflicted.path, 1));
    expect(documents.buffers[conflicted.path].error).toBe(conflicted.error);
    await act(async () => documents.updateSnapshot(conflicted.path, { documentId: conflicted.documentId, projectGeneration: conflicted.projectGeneration, incarnation: conflicted.incarnation, requestId: "conflict-snapshot", revision: 1, bodyHtml: "<p>Typing</p>" }));
    expect(documents.buffers[conflicted.path].error).toBe(conflicted.error);
  } finally {
    await act(async () => root.unmount());
    poll.mockRestore();
    vi.useRealTimers();
  }
});
