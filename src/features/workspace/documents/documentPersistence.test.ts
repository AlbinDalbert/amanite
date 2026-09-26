import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalLoadedPage, FractalNativeDocumentParts, FractalProject } from "@/lib/fractal/types";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { clearDataflowEvents, readDataflowEvents } from "@/lib/dataflowTelemetry";
import { captureAndEncodeDocument } from "./documentEncoding";
import { AUTOSAVE_IDLE_DELAY_MS, AUTOSAVE_MAX_LAG_MS, RECOVERY_IDLE_DELAY_MS, RECOVERY_RETRY_DELAYS_MS } from "./documentRecovery";
import { DocumentRegistry } from "./documentRuntime";
import { bufferFromLoadedPage, bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
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

  it("keeps a protected document's exact source in a registry recovery draft", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "protected.fractal.html";
    const projectGeneration = 45;
    const protectedSource = "<!doctype html><html><head><title>Protected</title></head><body><main data-fractal-document><h1 data-fractal-title>Protected</h1><p class=\"keep-me\">Before</p></main></body></html>";
    const initialProject: FractalProject = {
      ...nativeProject(path),
      activePageSource: protectedSource,
      activePageContentHash: "protected-source",
      activePageNativeDocumentParts: null,
      pages: [{ path, contentHash: "protected-source", title: "Protected" }]
    };
    const buffer = { ...bufferFromProject(initialProject, protectedSource, false, { projectGeneration })!, dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    registry.openLoaded(path, { bodyHtml: "<p class=\"keep-me\">Before</p>", initialRevision: 1, title: "Protected" });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      clearDataflowEvents();
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);

      expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", {
        draft: expect.objectContaining({
          baseSourceHash: "protected-source",
          pagePath: path,
          revision: 1,
          source: protectedSource
        })
      });
      expect(readDataflowEvents().some((event) => event.name === "document.encode")).toBe(false);
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("reconstructs a non-active open page from its accepted persistence baseline", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "other.fractal.html";
    const projectGeneration = 45;
    const initialProject = nativeProject("index.fractal.html");
    const loaded: FractalLoadedPage = {
      path,
      source: NATIVE_SOURCE,
      contentHash: "other-source",
      links: [],
      backlinks: [],
      nativeDocumentParts: nativeParts()
    };
    const buffer = { ...bufferFromLoadedPage(loaded, loaded.source, false, { projectGeneration }), dirty: true, revision: 1 };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: updater => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      persistence.registerBaseline(path, loaded.source, loaded.nativeDocumentParts!);
      session.setTitle("Recovered title");
      await persistence.writeRecoveryDraft(buffer.documentId, 1);
      expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", {
        draft: expect.objectContaining({
          pagePath: path,
          source: expect.stringContaining("<title>Recovered title</title>")
        })
      });
    } finally {
      persistence.dispose();
      registry.dispose();
    }
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

  it("schedules native recovery from the session and never asks a mounted editor for a snapshot", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "scheduled.fractal.html";
    const projectGeneration = 47;
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const flushDocument = vi.fn(async () => { throw new Error("the mounted snapshot bridge should not run"); });
    const confirmed = vi.fn();
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      flushDocument,
      onDraftConfirmed: confirmed,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      session.setTitle("Scheduled title");
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);

      expect(flushDocument).not.toHaveBeenCalled();
      expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", {
        draft: expect.objectContaining({ pagePath: path, revision: 1, source: expect.stringContaining("Scheduled title") })
      });
      expect(confirmed).toHaveBeenCalledWith(buffer.documentId, 1);
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("retries a failed native recovery write without another edit and stops after session close", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockRejectedValueOnce(new Error("temporary native draft failure")).mockResolvedValue(undefined);
    const path = "retry-scheduled.fractal.html";
    const projectGeneration = 48;
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const failed = vi.fn();
    const confirmed = vi.fn();
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDraftConfirmed: confirmed,
      onDraftError: failed,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      session.setTitle("Retry title");
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);
      expect(failed).toHaveBeenCalledWith(buffer.documentId, "temporary native draft failure");
      expect(mockedInvoke).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(RECOVERY_RETRY_DELAYS_MS[0]);
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
      expect(confirmed).toHaveBeenCalledWith(buffer.documentId, 1);

      mockedInvoke.mockRejectedValueOnce(new Error("failure before close"));
      session.setTitle("Pending title");
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);
      expect(mockedInvoke).toHaveBeenCalledTimes(3);
      registry.close(session.documentId);
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS + RECOVERY_RETRY_DELAYS_MS[0]);
      expect(mockedInvoke).toHaveBeenCalledTimes(3);
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("moves native autosave scheduling into the document coordinator", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "autosave-scheduled.fractal.html";
    const projectGeneration = 49;
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const flushDocument = vi.fn(async () => { throw new Error("the mounted snapshot bridge should not run"); });
    const setPageContent = vi.spyOn(fractalClient, "setPageContent");
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      flushDocument,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      persistence.setAutoSave(true);
      clearDataflowEvents();
      session.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Autosaved from the session"));
        $getRoot().clear().append(paragraph);
      });
      await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
      const bodyHtml = captureAndEncodeDocument(session).bodyHtml;
      setPageContent.mockResolvedValue(saved(nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", bodyHtml), nativeParts({ contentHtml: bodyHtml, contentHash: "autosave-content", sourceHash: "autosave-source" }))));

      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_DELAY_MS);

      expect(flushDocument).not.toHaveBeenCalled();
      expect(setPageContent).toHaveBeenCalledWith(initialProject, bodyHtml, "content-hash");
      expect(buffersRef.current[path]).toMatchObject({ dirty: false, nativeEdits: {}, savedRevision: 1 });
      expect(session.getSnapshot()).toMatchObject({ bodyDirty: false, revision: 1 });
      const events = readDataflowEvents();
      expect(events.some((event) => event.name === "autosave.request" && event.status === "start")).toBe(true);
      expect(events.some((event) => event.name === "autosave.confirmed" && event.status === "success")).toBe(true);
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("coalesces edits that arrive while a native autosave is in flight", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "autosave-coalesced.fractal.html";
    const projectGeneration = 51;
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const firstWrite = deferred<FractalConditionalWriteResult>();
    const secondWrite = deferred<FractalConditionalWriteResult>();
    const setPageContent = vi.spyOn(fractalClient, "setPageContent")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const projectRef = { current: initialProject };
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: (next) => { projectRef.current = next; }
    });

    try {
      persistence.setAutoSave(true);
      session.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("First autosave revision"));
        $getRoot().clear().append(paragraph);
      });
      await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
      const firstBody = captureAndEncodeDocument(session).bodyHtml;
      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_DELAY_MS);
      expect(setPageContent).toHaveBeenCalledTimes(1);

      session.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Second autosave revision"));
        $getRoot().clear().append(paragraph);
      });
      await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(2));
      const secondBody = captureAndEncodeDocument(session).bodyHtml;
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MAX_LAG_MS);
      firstWrite.resolve(saved(nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", firstBody), nativeParts({ contentHtml: firstBody, contentHash: "coalesced-content-1", sourceHash: "coalesced-source-1" }))));
      await vi.waitFor(() => expect(setPageContent).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_DELAY_MS - 1);
      expect(setPageContent).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(setPageContent).toHaveBeenCalledTimes(2);
      secondWrite.resolve(saved(nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", secondBody), nativeParts({ contentHtml: secondBody, contentHash: "coalesced-content-2", sourceHash: "coalesced-source-2" }))));
      await vi.waitFor(() => expect(buffersRef.current[path].dirty).toBe(false));
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("keeps the captured local body after a native autosave failure and does not retry a conflict-free revision forever", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const path = "autosave-failure.fractal.html";
    const projectGeneration = 50;
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!;
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockRejectedValue(new Error("disk full"));
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      persistence.setAutoSave(true);
      session.update(() => {
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Keep this after failure"));
        $getRoot().clear().append(paragraph);
      });
      await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
      const bodyHtml = captureAndEncodeDocument(session).bodyHtml;
      clearDataflowEvents();

      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_DELAY_MS);
      const failedBuffer = buffersRef.current[path];
      expect(setPageContent).toHaveBeenCalledTimes(1);
      expect(failedBuffer).toMatchObject({ dirty: true, error: "disk full", nativeEdits: { content: bodyHtml } });
      expect(session.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Keep this after failure");
      expect(readDataflowEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ name: "autosave.confirmed", status: "failure", revision: 1 })]));

      await vi.advanceTimersByTimeAsync(AUTOSAVE_IDLE_DELAY_MS * 3);
      expect(setPageContent).toHaveBeenCalledTimes(1);
    } finally {
      persistence.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("clears sent edits after a fully saved buffer", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.nativeEdits = { content: "<p>After</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(path, NATIVE_SOURCE.replace("Before", "After"), nativeParts({ contentHtml: "<p>After</p>", contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
    const result: NativeSaveResult = { kind: "saved", project: savedProject, sent: buffer.nativeEdits, resultingPath: path };

    expect(nextDocumentBuffer(buffer, buffer, result, savedProject, path, buffer.nativeEdits)).toMatchObject({
      contentHash: "source-hash-2",
      dirty: false,
      error: null,
      nativeEdits: {}
    });
  });

  it("keeps a conflict dirty without replacing the local source", () => {
    const path = "index.fractal.html";
    const initialProject = nativeProject(path);
    const buffer = bufferFromProject(initialProject)!;
    buffer.nativeEdits = { content: "<p>Local edit</p>" };
    buffer.dirty = true;
    const result: NativeSaveResult = { kind: "conflict", message: "page changed", project: initialProject, sent: buffer.nativeEdits, resultingPath: path };

    expect(nextDocumentBuffer(buffer, buffer, result, initialProject, path, buffer.nativeEdits)).toMatchObject({
      conflict: true,
      dirty: true,
      error: "This page changed on disk. Reload it or replace the external version."
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
      path: "renamed.fractal.html"
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
      [path]: { ...current[path], nativeEdits: { content: "<p>Revision two</p>" }, dirty: true, revision: 2 }
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
      [secondPath]: { ...current[secondPath], nativeEdits: { content: "<p>Second changed</p>" }, dirty: true, revision: 1 }
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

  it("replaces every local native section from a fresh baseline", async () => {
    const path = "index.fractal.html";
    const projectGeneration = 52;
    const initialProject = nativeProject(path);
    const buffer = {
      ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!,
      conflict: true,
      nativeEdits: { style: "body { color: red; }", metadata: "<meta name=\"local\">" }
    };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const localBody = captureAndEncodeDocument(session).bodyHtml;
    const externalBody = "<p>External edit</p>";
    const externalParts = nativeParts({ contentHtml: externalBody, contentHash: "external-content", styleCss: "body { color: blue; }", metadataHtml: "<meta name=\"external\">", sourceHash: "external-source" });
    const externalSource = NATIVE_SOURCE.replace("<p>Before</p>", externalBody);
    const savedParts = nativeParts({ contentHtml: localBody, contentHash: "local-content", sourceHash: "local-source" });
    const savedProject = nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", localBody), savedParts);
    const readPage = vi.spyOn(fractalClient, "readPage").mockResolvedValue({ path, source: externalSource, contentHash: "external-source", links: [], backlinks: [], nativeDocumentParts: externalParts });
    const setPageTitle = vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue(saved(savedProject));
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue(saved(savedProject));
    const setPageStyle = vi.spyOn(fractalClient, "setPageStyle").mockResolvedValue(saved(savedProject));
    const setPageMetadata = vi.spyOn(fractalClient, "setPageMetadata").mockResolvedValue(saved(savedProject));
    const buffersProject = { current: initialProject };
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: buffersProject,
      publishProject: (next) => { buffersProject.current = next; }
    });

    try {
      await expect(persistence.replaceExternal(path)).resolves.toBe(true);

      expect(readPage).toHaveBeenCalledWith(expect.objectContaining({ rootPath: initialProject.rootPath, activePagePath: path }), path);
      expect(setPageTitle).toHaveBeenCalledWith(expect.anything(), "Test", "title-hash");
      expect(setPageContent).toHaveBeenCalledWith(expect.anything(), localBody, "external-content");
      expect(setPageStyle).toHaveBeenCalledWith(expect.anything(), "body { color: red; }", "style-hash");
      expect(setPageMetadata).toHaveBeenCalledWith(expect.anything(), "<meta name=\"local\">", "metadata-hash");
      expect(buffersRef.current[path]).toMatchObject({ conflict: false, dirty: false, nativeEdits: {}, savedRevision: 0 });
      expect(session.getSnapshot()).toMatchObject({ bodyDirty: false, revision: 0 });
    } finally {
      persistence.dispose();
      registry.dispose();
    }
  });

  it("keeps local sections and the conflict visible when replace-disk races a new write", async () => {
    const path = "index.fractal.html";
    const projectGeneration = 53;
    const initialProject = nativeProject(path);
    const buffer = { ...bufferFromProject(initialProject, NATIVE_SOURCE, false, { projectGeneration })!, conflict: true };
    const buffersRef = { current: { [path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    registry.openLoaded(path, { bodyHtml: "<p>Before</p>", title: "Test" });
    const externalBody = "<p>External edit</p>";
    const externalParts = nativeParts({ contentHtml: externalBody, contentHash: "external-content", sourceHash: "external-source" });
    const readPage = vi.spyOn(fractalClient, "readPage").mockResolvedValue({
      path,
      source: NATIVE_SOURCE.replace("<p>Before</p>", externalBody),
      contentHash: "external-source",
      links: [],
      backlinks: [],
      nativeDocumentParts: externalParts
    });
    vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue(saved(initialProject));
    const setPageContent = vi.spyOn(fractalClient, "setPageContent").mockResolvedValue({ status: "conflict", error: { code: "conflict", message: "changed again" } });
    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers: (updater) => { buffersRef.current = updater(buffersRef.current); },
      documentRegistry: registry,
      onDocumentPathChange: vi.fn(),
      projectRef: { current: initialProject },
      publishProject: vi.fn()
    });

    try {
      await expect(persistence.replaceExternal(path)).resolves.toBe(false);

      expect(readPage).toHaveBeenCalledTimes(1);
      expect(setPageContent).toHaveBeenCalledWith(expect.anything(), "<p><span>Before</span></p>", "external-content");
      expect(buffersRef.current[path]).toMatchObject({ conflict: true, dirty: true, operation: null });
      expect(buffersRef.current[path].nativeEdits).toMatchObject({ content: "<p><span>Before</span></p>", style: "body { color: black; }", metadata: "" });
    } finally {
      persistence.dispose();
      registry.dispose();
    }
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
    buffer.nativeEdits = { title: "Renamed", content: "<p>Local edit</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(nextPath, NATIVE_SOURCE.replaceAll("Test", "Renamed").replace("Before", "Local edit"), nativeParts({ title: "Renamed", titleHash: "title-hash-2" }));
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
    buffer.nativeEdits = { content: "<p>After</p>" };
    buffer.dirty = true;
    buffer.revision = 1;
    const savedProject = nativeProject(path, NATIVE_SOURCE.replace("<p>Before</p>", "<p>After</p>"), nativeParts({ contentHtml: "<p>After</p>", contentHash: "content-hash-2", sourceHash: "source-hash-2" }));
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
    buffer.nativeEdits = { title: "Renamed" };
    buffer.dirty = true;
    buffer.revision = 1;
    const nextPath = "renamed.fractal.html";
    const savedProject = nativeProject(nextPath, NATIVE_SOURCE.replaceAll("Test", "Renamed"), nativeParts({ title: "Renamed", titleHash: "title-hash-2", sourceHash: "source-hash-2" }));
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
    expect(buffersRef.current[path]).toMatchObject({ dirty: false, nativeEdits: {}, revision: 1 });

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
    expect(buffersRef.current[path]).toMatchObject({ dirty: false, nativeEdits: {}, revision: 2, savedRevision: 2 });
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
