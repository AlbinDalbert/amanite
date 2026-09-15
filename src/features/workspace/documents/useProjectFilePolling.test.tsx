import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalPageContentState, FractalProject } from "@/lib/fractal/types";
import { bufferFromProject, type DocumentBuffers } from "./documentBuffers";
import { useProjectFilePolling } from "./useProjectFilePolling";

it("ignores a poll that overlaps a section save, but still reports a subsequent external edit", async () => {
  vi.useFakeTimers();
  const project: FractalProject = { name: "Test", version: 2, rootPath: "/tmp/poll", pages: [], folders: [], activePagePath: "notes.fractal.html", activePageSource: '<main data-fractal-document><p>Before</p></main>', activePageContentHash: "base", activePageLinks: [], activePageBacklinks: [], activePageNativeDocumentParts: { title: "Notes", titleHash: "title", contentHtml: "<p>Before</p>", contentHash: "before", styleCss: "", styleHash: "style", metadataHtml: "", metadataHash: "metadata", sourceHash: "base" } };
  const buffer = { ...bufferFromProject(project)!, dirty: true, nativeEdits: { content: "<p>Typed</p>" } };
  const buffersRef = { current: { [buffer.path]: buffer } as DocumentBuffers };
  let finish!: (states: FractalPageContentState[]) => void;
  const poll = vi.spyOn(fractalClient, "pageContentStates").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const state = { path: buffer.path, contentHash: "saved", nativeDocumentHashes: { ...project.activePageNativeDocumentParts!, contentHash: "saved-content", sourceHash: "saved" } };
  function Harness() {
    useProjectFilePolling({ buffersRef, projectRef: { current: project }, commitBuffers: updater => { buffersRef.current = updater(buffersRef.current); }, onError: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    // A save advances the content-section baseline while newer edits keep the
    // whole-source recovery baseline at its previous hash.
    buffersRef.current = { [buffer.path]: { ...buffer, nativeDocumentParts: { ...buffer.nativeDocumentParts!, contentHash: "saved-content" }, nativeEdits: { content: "<p>Newer typing</p>" } } };
    await act(async () => finish([state]));
    expect(buffersRef.current[buffer.path].conflict).toBe(false);
    buffersRef.current = { [buffer.path]: { ...buffersRef.current[buffer.path], revision: 2, snapshotRevision: 1, nativeEdits: {} } };
    poll.mockResolvedValue([state]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(buffersRef.current[buffer.path].conflict).toBe(false);
    poll.mockResolvedValue([{ ...state, nativeDocumentHashes: { ...state.nativeDocumentHashes, contentHash: "external-content" } }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(buffersRef.current[buffer.path].conflict).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});
