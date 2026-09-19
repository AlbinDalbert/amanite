import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalNativeDocumentParts, FractalProject } from "@/lib/fractal/types";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { clearDataflowEvents, readDataflowEvents } from "@/lib/dataflowTelemetry";
import { captureAndEncodeDocument } from "./documentEncoding";
import { DocumentRegistry } from "./documentRuntime";
import { bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { createDocumentPersistence, nextDocumentBuffer, type NativeSaveResult } from "./documentPersistence";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function saved(projectSnapshot: FractalProject): FractalConditionalWriteResult {
  return {
    status: "saved",
    result: {
      project: projectSnapshot,
      receipt: { operation: "set_page_content", changes: [], warnings: [] }
    }
  };
}

const NATIVE_SOURCE = "<!doctype html><html><head><meta name=\"fractal-format\" content=\"1\"><title>Test</title><style data-fractal-style>body { color: black; }</style></head><body><main data-fractal-document><h1 data-fractal-title>Test</h1><p>Before</p></main></body></html>";

function nativeParts(overrides: Partial<FractalNativeDocumentParts> = {}): FractalNativeDocumentParts {
  return {
    title: "Test",
    titleHash: "title-hash",
    contentHtml: "<p>Before</p>",
    contentHash: "content-hash",
    styleCss: "body { color: black; }",
    styleHash: "style-hash",
    metadataHtml: "",
    metadataHash: "metadata-hash",
    sourceHash: "source-hash",
    ...overrides
  };
}

function nativeProject(path: string, source = NATIVE_SOURCE, parts = nativeParts()): FractalProject {
  return {
    name: "Test",
    version: 2,
    rootPath: "/tmp/amanite-test",
    pages: [{ path, contentHash: parts.sourceHash, title: parts.title }],
    folders: [],
    activePagePath: path,
    activePageSource: source,
    activePageLinks: [],
    activePageBacklinks: [],
    activePageContentHash: parts.sourceHash,
    activePageNativeDocumentParts: parts
  };
}

describe("document persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("writes an open recovery draft from the registry session without a mounted snapshot", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "test.fractal.html";
    const projectGeneration = 45;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!, dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Recovery edit"));
      $getRoot().clear().append(paragraph);
    });
    session.setTitle("Recovery title");
    await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(2));
    buffersRef.current[path] = { ...buffer, revision: 2 };
    const editorStateBefore = session.editor.getEditorState();
    clearDataflowEvents();
    const flushDocument = vi.fn(async () => { throw new Error("the mounted snapshot bridge should not run"); });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      flushDocument,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    await expect(persistence.writeRecoveryDraft(buffer.documentId, 2)).resolves.toEqual({ revision: 2, status: "written" });

    expect(flushDocument).not.toHaveBeenCalled();
    expect(session.editor.getEditorState()).toBe(editorStateBefore);
    expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", {
      draft: expect.objectContaining({
        baseSourceHash: "source-hash",
        pagePath: path,
        revision: 2,
        source: expect.stringContaining("Recovery edit")
      })
    });
    const draft = mockedInvoke.mock.calls.find(([command]) => command === "fractal_write_draft")?.[1] as { draft: { source: string } } | undefined;
    expect(draft?.draft.source).toContain("data-fractal-style");
    expect(draft?.draft.source).toContain("<title>Recovery title</title>");
    expect(draft?.draft.source).toContain('data-fractal-title=""');
    expect(draft?.draft.source).toContain(">Recovery title</h1>");
    expect(readDataflowEvents().some((event) => event.name === "snapshot.request")).toBe(false);

    registry.dispose();
  });

  it("rejects a recovery capture from an obsolete session incarnation and leaves local state intact", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    const path = "test.fractal.html";
    const projectGeneration = 46;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration, incarnation: 2 })!, dirty: true, revision: 3 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    await expect(persistence.writeRecoveryDraft(buffer.documentId, 3)).rejects.toThrow("obsolete document incarnation");
    expect(buffersRef.current[path]).toBe(buffer);
    expect(mockedInvoke).not.toHaveBeenCalled();

    registry.dispose();
  });

  it("clears sent edits after a fully saved buffer", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replace("Before", "After");
    buffer.nativeEdits = { content: "<p>After</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(path, buffer.source, nativeParts({ contentHtml: "<p>After</p>", contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
    const result: NativeSaveResult = { kind: "saved", project: savedProject, sent: buffer.nativeEdits, resultingPath: path };

    expect(nextDocumentBuffer(buffer, buffer, result, savedProject, path, buffer.nativeEdits)).toMatchObject({
      contentHash: "source-hash-2",
      dirty: false,
      error: null,
      nativeEdits: {},
      source: buffer.source
    });
  });

  it("keeps a conflict dirty without replacing the local source", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replace("Before", "Local edit");
    buffer.nativeEdits = { content: "<p>Local edit</p>" };
    buffer.dirty = true;
    const result: NativeSaveResult = { kind: "conflict", message: "page changed", project: initialProject, sent: buffer.nativeEdits, resultingPath: path };

    expect(nextDocumentBuffer(buffer, buffer, result, initialProject, path, buffer.nativeEdits)).toMatchObject({
      conflict: true,
      dirty: true,
      error: "This page changed on disk. Reload it or replace the external version.",
      source: buffer.source
    });
  });

  it("keeps unsent edits dirty after a partial failure", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.nativeEdits = { title: "Renamed", content: "<p>Local edit</p>" };
    buffer.dirty = true;
    const result: NativeSaveResult = { kind: "failed", message: "disk full", project: initialProject, sent: { title: "Renamed" }, resultingPath: "renamed.fractal.html" };

    expect(nextDocumentBuffer(buffer, buffer, result, initialProject, result.resultingPath, result.sent)).toMatchObject({
      dirty: true,
      error: "disk full",
      nativeEdits: { content: "<p>Local edit</p>" },
      path: "renamed.fractal.html",
      source: buffer.source
    });
  });

  it("acknowledges only the native section that was committed", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.nativeEdits = { title: "Renamed", content: "<p>Local edit</p>" };
    buffer.dirty = true;
    buffer.revision = 3;
    const savedProject = nativeProject(path, NATIVE_SOURCE.replace("Test", "Renamed"), nativeParts({
      title: "Renamed",
      titleHash: "title-hash-2",
      contentHtml: "<p>External edit</p>",
      contentHash: "external-content"
    }));
    const result: NativeSaveResult = { kind: "failed", outcome: "failed", message: "content write failed", project: savedProject, sent: { title: "Renamed" }, resultingPath: path };

    expect(nextDocumentBuffer(buffer, buffer, result, savedProject, path, result.sent)).toMatchObject({
      dirty: true,
      nativeDocumentParts: {
        title: "Renamed",
        titleHash: "title-hash-2",
        contentHtml: "<p>Before</p>",
        contentHash: "content-hash"
      },
      nativeEdits: { content: "<p>Local edit</p>" },
      operationOutcome: "partial",
      savedRevision: 0
    });
  });

  it("leaves newer native edits dirty without replacing them", async () => {
    const path = "index.fractal.html";
    const firstProject = nativeProject(path);
    const firstBuffer = bufferFromProject(firstProject)!;
    firstBuffer.source = NATIVE_SOURCE.replace("Before", "Revision one");
    firstBuffer.nativeEdits = { content: "<p>Revision one</p>" };
    firstBuffer.dirty = true;
    firstBuffer.revision = 1;
    const buffersRef = { current: { [path]: firstBuffer } as DocumentBuffers };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const publishProject = vi.fn((next: FractalProject) => { projectRef.current = next; });
    const firstWrite = deferred<FractalConditionalWriteResult>();

    vi.spyOn(fractalClient, "setPageContent")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(saved(nativeProject(path, NATIVE_SOURCE.replace("Before", "Revision two"), nativeParts({ contentHtml: "<p>Revision two</p>", contentHash: "content-hash-3", sourceHash: "source-hash-3" }))));

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject });
    const saving = persistence.saveDocument(path);
    expect(persistence.saveDocument(path)).toBe(saving);
    await vi.waitFor(() => expect(fractalClient.setPageContent).toHaveBeenCalledTimes(1));

    commitBuffers((current) => ({
      ...current,
      [path]: { ...current[path], source: NATIVE_SOURCE.replace("Before", "Revision two"), nativeEdits: { content: "<p>Revision two</p>" }, dirty: true, revision: 2 }
    }));
    firstWrite.resolve(saved(nativeProject(path, NATIVE_SOURCE.replace("Before", "Revision one"), nativeParts({ contentHtml: "<p>Revision one</p>", contentHash: "content-hash-2", sourceHash: "source-hash-2" }))));

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.setPageContent).toHaveBeenCalledTimes(2);
    expect(buffersRef.current[path]).toMatchObject({
      contentHash: "source-hash-3",
      dirty: false,
      operation: null,
      revision: 2,
      nativeEdits: {}
    });
    expect(publishProject).toHaveBeenCalled();
  });

  it.each([false, true])("bounds autosave work and lets explicit save upgrade it: %s", async (manualSave) => {
    const path = "notes.fractal.html";
    const project = nativeProject(path);
    const buffer = { ...bufferFromProject(project)!, dirty: true, revision: 1, nativeEdits: { content: "<p>One</p>" } };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const projectRef = { current: project };
    const firstWrite = deferred<FractalConditionalWriteResult>();
    const write = vi.spyOn(fractalClient, "setPageContent")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(saved(nativeProject(path, NATIVE_SOURCE.replace("Before", "Two"), nativeParts({ contentHtml: "<p>Two</p>", contentHash: "two", sourceHash: "source-two" }))));
    const persistence = createDocumentPersistence({ buffersRef, projectRef, commitBuffers: updater => { buffersRef.current = updater(buffersRef.current); }, onDocumentPathChange: vi.fn(), publishProject: next => { projectRef.current = next; } });
    const saving = persistence.autosaveDocument(path);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    buffersRef.current = { [path]: { ...buffersRef.current[path], revision: 2, nativeEdits: { content: "<p>Two</p>" } } };
    if (manualSave) expect(persistence.saveDocument(path)).toBe(saving);
    firstWrite.resolve(saved(nativeProject(path, NATIVE_SOURCE.replace("Before", "One"), nativeParts({ contentHtml: "<p>One</p>", contentHash: "one", sourceHash: "source-one" }))));
    await expect(saving).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(manualSave ? 2 : 1);
    expect(buffersRef.current[path].dirty).toBe(!manualSave);
    if (!manualSave) {
      expect(buffersRef.current[path].nativeEdits.content).toBe("<p>Two</p>");
      await expect(persistence.autosaveDocument(path)).resolves.toBe(true);
      expect(write).toHaveBeenCalledTimes(2);
      expect(buffersRef.current[path].dirty).toBe(false);
    }
  });

  it("rescans dirty buffers before save-all returns", async () => {
    const firstPath = "first.fractal.html";
    const secondPath = "second.fractal.html";
    const firstProject = nativeProject(firstPath);
    const firstBuffer = bufferFromProject(firstProject)!;
    firstBuffer.nativeEdits = { content: "<p>First changed</p>" };
    firstBuffer.dirty = true;
    firstBuffer.revision = 1;
    const secondProject = nativeProject(secondPath);
    const buffersRef = {
      current: {
        [firstPath]: firstBuffer,
        [secondPath]: bufferFromProject(secondProject)!
      } as DocumentBuffers
    };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const publishProject = (next: FractalProject) => { projectRef.current = next; };
    const firstWrite = deferred<FractalConditionalWriteResult>();

    vi.spyOn(fractalClient, "setPageContent")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(saved(nativeProject(secondPath, NATIVE_SOURCE.replace("Before", "Second changed"), nativeParts({ contentHtml: "<p>Second changed</p>", sourceHash: "source-hash-3" }))));

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject });
    const saving = persistence.saveAll();
    await vi.waitFor(() => expect(fractalClient.setPageContent).toHaveBeenCalledTimes(1));
    commitBuffers((current) => ({
      ...current,
      [secondPath]: { ...current[secondPath], source: NATIVE_SOURCE.replace("Before", "Second changed"), nativeEdits: { content: "<p>Second changed</p>" }, dirty: true, revision: 1 }
    }));
    firstWrite.resolve(saved(nativeProject(firstPath, NATIVE_SOURCE.replace("Before", "First changed"), nativeParts({ contentHtml: "<p>First changed</p>", sourceHash: "source-hash-2" }))));

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.setPageContent).toHaveBeenCalledTimes(2);
    expect(buffersRef.current[secondPath]).toMatchObject({ dirty: false });
  });

  it("saves only the requested buffers for a scoped barrier", async () => {
    const firstPath = "first.fractal.html";
    const secondPath = "second.fractal.html";
    const firstProject = nativeProject(firstPath);
    const secondProject = nativeProject(secondPath);
    const firstBuffer = bufferFromProject(firstProject)!;
    firstBuffer.nativeEdits = { content: "<p>First changed</p>" };
    firstBuffer.dirty = true;
    const secondBuffer = bufferFromProject(secondProject)!;
    secondBuffer.nativeEdits = { content: "<p>Second changed</p>" };
    secondBuffer.dirty = true;
    const buffersRef = { current: { [firstPath]: firstBuffer, [secondPath]: secondBuffer } as DocumentBuffers };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue(saved(nativeProject(firstPath, NATIVE_SOURCE.replace("Before", "First changed"), nativeParts({ contentHtml: "<p>First changed</p>", sourceHash: "first-saved" }))));
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject: vi.fn() });

    await expect(persistence.savePaths([firstPath])).resolves.toBe(true);

    expect(setPageContent).toHaveBeenCalledTimes(1);
    expect(buffersRef.current[firstPath]).toMatchObject({ dirty: false });
    expect(buffersRef.current[secondPath]).toMatchObject({ dirty: true, nativeEdits: { content: "<p>Second changed</p>" } });
  });

  it("reports a conditional-write conflict without overwriting the page", async () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replace("Before", "Local edit");
    buffer.nativeEdits = { content: "<p>Local edit</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const buffersRef = {
      current: { [path]: buffer } as DocumentBuffers
    };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    vi.spyOn(fractalClient, "setPageContent").mockResolvedValue({
      status: "conflict",
      error: { code: "conflict", message: "page changed" }
    });

    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(buffersRef.current[path]).toMatchObject({ conflict: true, dirty: true, operation: null });
  });

  it("refreshes an uncertain Fractal outcome without dropping the local buffer", async () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.nativeEdits = { content: "<p>Local edit</p>" };
    buffer.dirty = true;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const refreshed = nativeProject(path, NATIVE_SOURCE.replace("Before", "External edit"), nativeParts({ contentHtml: "<p>External edit</p>", contentHash: "external-content" }));
    vi.spyOn(fractalClient, "setPageContent").mockRejectedValue({ code: "mutation_committed", message: "commit marker remains" });
    const refresh = vi.spyOn(fractalClient, "openProjectPath").mockResolvedValue(refreshed);
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef: { current: initialProject }, publishProject: vi.fn() });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);

    expect(refresh).toHaveBeenCalledWith(initialProject.rootPath);
    expect(buffersRef.current[path]).toMatchObject({ dirty: true, operation: null, operationOutcome: "mutation_committed", nativeEdits: { content: "<p>Local edit</p>" } });
  });

  it("keeps the buffer when the editor barrier fails", async () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.dirty = true;
    buffer.nativeEdits = { content: "<p>Local edit</p>" };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      flushDocument: async () => { throw new Error("composition is still active"); },
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(buffersRef.current[path]).toMatchObject({ dirty: true, operation: null, operationOutcome: "failed", error: "composition is still active" });
  });

  it("checks every section against the original snapshot", async () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replaceAll("Test", "Renamed").replace("Before", "Local edit");
    buffer.nativeEdits = { title: "Renamed", content: "<p>Local edit</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const titleProject = nativeProject(path, NATIVE_SOURCE.replace("Before", "External edit"), nativeParts({ contentHtml: "<p>External edit</p>", contentHash: "external-content" }));
    vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue(saved(titleProject));
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue({
      status: "conflict",
      error: { code: "conflict", message: "content changed" }
    });

    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(setPageContent).toHaveBeenCalledWith(titleProject, "<p>Local edit</p>", "content-hash");
    expect(buffersRef.current[path]).toMatchObject({ conflict: true, dirty: true, nativeEdits: { content: "<p>Local edit</p>" } });
  });

  it("keeps a committed rename visible when a later section fails", async () => {
    const path = "test.fractal.html";
    const nextPath = "renamed.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replaceAll("Test", "Renamed").replace("Before", "Local edit");
    buffer.nativeEdits = { title: "Renamed", content: "<p>Local edit</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(nextPath, buffer.source, nativeParts({ title: "Renamed", titleHash: "title-hash-2" }));
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue({
      status: "saved",
      result: { project: savedProject, receipt: { operation: "set_page_title", warnings: [], changes: [
        { change: "moved", from: `pages/${path}`, to: `pages/${nextPath}`, entry: "file" }
      ] } }
    });
    vi.spyOn(fractalClient, "setPageContent").mockRejectedValue(new Error("disk full"));
    const onDocumentPathChange = vi.fn();
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange, projectRef, publishProject: vi.fn() });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(buffersRef.current[path]).toBeUndefined();
    expect(buffersRef.current[nextPath]).toMatchObject({ path: nextPath, dirty: true, error: "disk full", nativeEdits: { content: "<p>Local edit</p>" } });
    expect(onDocumentPathChange).toHaveBeenCalledWith(path, nextPath);
  });

  it("saves native body edits through Fractal's content section", async () => {
    const path = "test.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replace("<p>Before</p>", "<p>After</p>");
    buffer.nativeEdits = { content: "<p>After</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(path, buffer.source, nativeParts({ contentHtml: "<p>After</p>", contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue(saved(savedProject));
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject: vi.fn() });

    await expect(persistence.saveDocument(path)).resolves.toBe(true);
    expect(setPageContent).toHaveBeenCalledWith(initialProject, "<p>After</p>", "content-hash");
    expect(buffersRef.current[path]).toMatchObject({ dirty: false, nativeDocumentParts: savedProject.activePageNativeDocumentParts, nativeEdits: {} });
  });

  it("renames the open buffer when a native title edit changes its path", async () => {
    const path = "test.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.source = NATIVE_SOURCE.replaceAll("Test", "Renamed");
    buffer.nativeEdits = { title: "Renamed" };
    buffer.dirty = true;
    buffer.revision = 1;
    const nextPath = "renamed.fractal.html";
    const savedProject = nativeProject(nextPath, buffer.source, nativeParts({ title: "Renamed", titleHash: "title-hash-2", sourceHash: "source-hash-2" }));
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const onDocumentPathChange = vi.fn();
    const setPageTitle = vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue({
      status: "saved",
      result: { project: savedProject, receipt: { operation: "set_page_title", warnings: [], changes: [
        { change: "moved", from: `pages/${path}`, to: `pages/${nextPath}`, entry: "file" }
      ] } }
    });
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange, projectRef, publishProject: vi.fn() });

    await expect(persistence.saveDocument(path)).resolves.toBe(true);
    expect(setPageTitle).toHaveBeenCalledWith(initialProject, "Renamed", "title-hash");
    expect(onDocumentPathChange).toHaveBeenCalledWith(path, nextPath);
    expect(buffersRef.current[path]).toBeUndefined();
    expect(buffersRef.current[nextPath]).toMatchObject({ path: nextPath, dirty: false });
  });

  it("captures an open session directly and acknowledges the native section without reloading it", async () => {
    const path = "test.fractal.html";
    const projectGeneration = 42;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!, dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("After"));
      $getRoot().clear().append(paragraph);
    });
    await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
    const stateBeforeSave = session.editor.getEditorState();
    const savedBody = "<p><span>After</span></p>";
    const savedSource = NATIVE_SOURCE.replace("<p>Before</p>", savedBody);
    const savedProject = nativeProject(path, savedSource, nativeParts({ contentHtml: savedBody, contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue(saved(savedProject));
    const flushDocument = vi.fn(async () => { throw new Error("the mounted editor flush should not run"); });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      flushDocument,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(true);

    expect(flushDocument).not.toHaveBeenCalled();
    expect(setPageContent).toHaveBeenCalledWith(initialProject, savedBody, "content-hash");
    expect(session.editor.getEditorState()).toBe(stateBeforeSave);
    expect(session.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("After");
    expect(session.getSnapshot()).toMatchObject({ bodyDirty: false, revision: 1, title: "Test" });
    expect(buffersRef.current[path]).toMatchObject({ bodyHtml: savedBody, dirty: false, nativeEdits: {}, revision: 1, title: "Test" });

    registry.dispose();
  });

  it("saves a newer session revision after the earlier direct write finishes", async () => {
    const path = "test.fractal.html";
    const projectGeneration = 43;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!, dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const firstWrite = deferred<FractalConditionalWriteResult>();

    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("One"));
      $getRoot().clear().append(paragraph);
    });
    await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
    const firstBody = captureAndEncodeDocument(session).bodyHtml;
    const firstProject = nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", firstBody), nativeParts({ contentHtml: firstBody, contentHash: "content-hash-1", sourceHash: "source-hash-1" }));
    const secondWrite = deferred<FractalConditionalWriteResult>();
    const setPageContent = vi.spyOn(fractalClient, "setPageContent")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const projectRef = { current: initialProject };
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: (next) => { projectRef.current = next; }
    });

    const saving = persistence.saveDocument(path);
    await vi.waitFor(() => expect(setPageContent).toHaveBeenCalledTimes(1));
    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Two"));
      $getRoot().clear().append(paragraph);
    });
    await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(2));
    const secondBody = captureAndEncodeDocument(session).bodyHtml;
    commitBuffers((current) => ({
      ...current,
      [path]: { ...current[path], dirty: true, revision: 2, nativeEdits: { content: secondBody } }
    }));
    firstWrite.resolve(saved(firstProject));
    await vi.waitFor(() => expect(setPageContent).toHaveBeenCalledTimes(2));
    const secondProject = nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", secondBody), nativeParts({ contentHtml: secondBody, contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
    secondWrite.resolve(saved(secondProject));

    await expect(saving).resolves.toBe(true);
    expect(setPageContent).toHaveBeenNthCalledWith(1, initialProject, firstBody, "content-hash");
    expect(setPageContent.mock.calls[1]?.[0]).toMatchObject({
      activePageNativeDocumentParts: { contentHash: "content-hash-1", contentHtml: firstBody },
      activePagePath: path
    });
    expect(setPageContent).toHaveBeenNthCalledWith(2, expect.anything(), secondBody, "content-hash-1");
    expect(buffersRef.current[path]).toMatchObject({ bodyHtml: secondBody, dirty: false, nativeEdits: {}, revision: 2, savedRevision: 2 });
    expect(session.getSnapshot().revision).toBe(2);

    registry.dispose();
  });

  it("renames the open session when a native title save moves its path", async () => {
    const path = "test.fractal.html";
    const nextPath = "renamed.fractal.html";
    const projectGeneration = 44;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!, dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    session.setTitle("Renamed");
    const savedProject = nativeProject(nextPath, NATIVE_SOURCE.replaceAll("Test", "Renamed"), nativeParts({ title: "Renamed", titleHash: "title-hash-2", sourceHash: "source-hash-2" }));
    const setPageContent = vi.spyOn(fractalClient, "setPageContent");
    const setPageTitle = vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue({
      status: "saved",
      result: { project: savedProject, receipt: { operation: "set_page_title", warnings: [], changes: [
        { change: "moved", from: `pages/${path}`, to: `pages/${nextPath}`, entry: "file" }
      ] } }
    });
    const projectRef = { current: initialProject };
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: (next) => { projectRef.current = next; }
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(true);
    expect(setPageTitle).toHaveBeenCalledWith(initialProject, "Renamed", "title-hash");
    expect(setPageContent).not.toHaveBeenCalled();
    expect(registry.getByPath(path)).toBeUndefined();
    expect(registry.getByPath(nextPath)).toBe(session);
    expect(session.getSnapshot().path).toBe(nextPath);

    registry.dispose();
  });
});
