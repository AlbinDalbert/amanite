import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { $getRoot } from "lexical";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalProject } from "@/lib/fractal/types";
import { bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { DocumentRegistry } from "./documentRuntime";
import { resolveDocumentDraft } from "./documentDraftRecovery";
import { useDocumentLoading } from "./useDocumentLoading";

vi.mock("./documentDraftRecovery", () => ({ resolveDocumentDraft: vi.fn(async ({ source }: { source: string }) => ({ source, dirty: false, revision: 0, draftedRevision: 0 })) }));
const source = '<html><head><title>Notes</title></head><body><main data-fractal-document><p>Before</p></main></body></html>';
const project: FractalProject = { name: "Test", version: 2, rootPath: "/tmp/loading", pages: [], folders: [], activePagePath: null, activePageSource: null, activePageLinks: [], activePageBacklinks: [], activePageContentHash: null };
afterEach(() => vi.restoreAllMocks());

it("does not recover or reinstall an open document when autosave publishes its first active snapshot", async () => {
  vi.mocked(resolveDocumentDraft).mockClear();
  vi.spyOn(fractalClient, "readPage").mockResolvedValue({ path: "notes.fractal.html", source, contentHash: "base", links: [], backlinks: [] });
  const buffersRef = { current: {} as DocumentBuffers };
  const projectRef = { current: project };
  const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
  const publishProject = (next: FractalProject) => { projectRef.current = next; };
  let loading!: ReturnType<typeof useDocumentLoading>;
  function Harness({ snapshot }: { snapshot: FractalProject }) {
    loading = useDocumentLoading({ buffersRef, commitBuffers, initialProject: snapshot, projectGeneration: 1, projectRef, publishProject, onRequestConfirmation: vi.fn(), setLoadErrors: vi.fn(), setLoadingPaths: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness snapshot={project} />));
  await act(async () => { await loading.openDocument("notes.fractal.html"); });
  const live = { ...buffersRef.current["notes.fractal.html"], dirty: true, revision: 5 };
  buffersRef.current = { [live.path]: live };
  const saved = { ...project, activePagePath: live.path, activePageSource: source, activePageContentHash: "saved" };
  await act(async () => root.render(<Harness snapshot={saved} />));
  expect(resolveDocumentDraft).toHaveBeenCalledTimes(1);
  expect(buffersRef.current[live.path]).toBe(live);
  const renamed = { ...live, path: "renamed.fractal.html" };
  buffersRef.current = { [renamed.path]: renamed };
  await act(async () => root.render(<Harness snapshot={{ ...saved, activePagePath: renamed.path }} />));
  expect(resolveDocumentDraft).toHaveBeenCalledTimes(1);
  expect(buffersRef.current[renamed.path]).toBe(renamed);
  await act(async () => root.unmount());
});

it("does not overwrite typing that arrives while the startup draft read is pending", async () => {
  let finish!: (value: { source: string; dirty: boolean; revision: number; draftedRevision: number }) => void;
  vi.mocked(resolveDocumentDraft).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const initial = { ...project, activePagePath: "notes.fractal.html", activePageSource: source };
  const buffer = bufferFromProject(initial)!;
  const buffersRef = { current: { [buffer.path]: buffer } as DocumentBuffers };
  const projectRef = { current: initial };
  function Harness() {
    useDocumentLoading({ buffersRef, commitBuffers: updater => { buffersRef.current = updater(buffersRef.current); }, initialProject: initial, projectGeneration: 1, projectRef, publishProject: vi.fn(), onRequestConfirmation: vi.fn(), setLoadErrors: vi.fn(), setLoadingPaths: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
  const edited = { ...buffer, dirty: true, revision: 1 };
  buffersRef.current = { [buffer.path]: edited };
  await act(async () => finish({ source, dirty: false, revision: 0, draftedRevision: 0 }));
  expect(buffersRef.current[buffer.path]).toBe(edited);
  await act(async () => root.unmount());
});

it("installs loaded content into the registry and replaces it in place on reload", async () => {
  const firstSource = source;
  const secondSource = source.replace("Before", "After reload");
  vi.spyOn(fractalClient, "readPage")
    .mockResolvedValueOnce({ path: "notes.fractal.html", source: firstSource, contentHash: "base", links: [], backlinks: [] })
    .mockResolvedValueOnce({ path: "notes.fractal.html", source: secondSource, contentHash: "next", links: [], backlinks: [] });
  const buffersRef = { current: {} as DocumentBuffers };
  const projectRef = { current: project };
  const registry = new DocumentRegistry({ projectGeneration: 1 });
  const registerBaseline = vi.fn();
  const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
  let loading!: ReturnType<typeof useDocumentLoading>;
  function Harness() {
    loading = useDocumentLoading({ buffersRef, commitBuffers, documentRegistry: registry, initialProject: project, projectGeneration: 1, projectRef, publishProject: next => { projectRef.current = next; }, registerBaseline, onRequestConfirmation: vi.fn(), setLoadErrors: vi.fn(), setLoadingPaths: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await loading.openDocument("notes.fractal.html"); });
    const first = registry.getByPath("notes.fractal.html");
    expect(first).toBeDefined();
    expect(first?.editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("Before");
    expect(registerBaseline).toHaveBeenCalledWith("notes.fractal.html", firstSource, null);
    const documentId = first?.documentId;
    const firstReplacementGeneration = first?.getSnapshot().replacementGeneration ?? 0;

    await act(async () => { await loading.reloadDocument("notes.fractal.html"); });
    const second = registry.getByPath("notes.fractal.html");
    expect(second?.documentId).toBe(documentId);
    expect(second?.getSnapshot().replacementGeneration).toBeGreaterThan(firstReplacementGeneration);
    expect(second?.editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("After reload");
    expect(registerBaseline).toHaveBeenLastCalledWith("notes.fractal.html", secondSource, null);
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});

it("marks an explicit reload as a barrier and keeps the conflict after a read failure", async () => {
  const firstLoaded = { path: "notes.fractal.html", source, contentHash: "base", links: [], backlinks: [] };
  const nextSource = source.replace("Before", "From disk");
  let resolveRead!: (value: typeof firstLoaded) => void;
  const readPage = vi.spyOn(fractalClient, "readPage")
    .mockResolvedValueOnce(firstLoaded)
    .mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }))
    .mockRejectedValueOnce(new Error("disk read failed"));
  const buffersRef = { current: {} as DocumentBuffers };
  const projectRef = { current: project };
  const registry = new DocumentRegistry({ projectGeneration: 1 });
  const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
  let loading!: ReturnType<typeof useDocumentLoading>;
  function Harness() {
    loading = useDocumentLoading({ buffersRef, commitBuffers, documentRegistry: registry, initialProject: project, projectGeneration: 1, projectRef, publishProject: next => { projectRef.current = next; }, onRequestConfirmation: vi.fn(), setLoadErrors: vi.fn(), setLoadingPaths: vi.fn() });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await loading.openDocument("notes.fractal.html"); });

    const reload = loading.reloadDocument("notes.fractal.html");
    expect(buffersRef.current["notes.fractal.html"].operation).toBe("load");
    resolveRead({ ...firstLoaded, source: nextSource, contentHash: "next" });
    await act(async () => { await expect(reload).resolves.toBe(true); });
    expect(buffersRef.current["notes.fractal.html"]).toMatchObject({ operation: null, conflict: false });
    expect(registry.getByPath("notes.fractal.html")?.editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("From disk");

    buffersRef.current = { "notes.fractal.html": { ...buffersRef.current["notes.fractal.html"], conflict: true, error: "Changed on disk" } };
    await act(async () => { await expect(loading.reloadDocument("notes.fractal.html")).resolves.toBe(false); });
    expect(buffersRef.current["notes.fractal.html"]).toMatchObject({ operation: null, conflict: true, error: "disk read failed" });
    expect(readPage).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});
