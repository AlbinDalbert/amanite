import { beforeEach, describe, expect, it, vi } from "vitest";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalNativeDocumentParts, FractalProject } from "@/lib/fractal/types";
import { bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { createDocumentPersistence } from "./documentPersistence";

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
    pages: [{ path, contentHash: parts.sourceHash, title: parts.title, text: "Before", links: [] }],
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
  beforeEach(() => vi.restoreAllMocks());

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
});
