import { beforeEach, describe, expect, it, vi } from "vitest";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalNativeDocumentParts, FractalProject } from "@/lib/fractal/types";
import { bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { createDocumentPersistence } from "./documentPersistence";

function project(path: string, source: string, hash: string): FractalProject {
  return {
    name: "Test",
    version: 2,
    rootPath: "/tmp/amanite-test",
    pages: [{ path, contentHash: hash, kind: "raw", title: "Test", text: "", links: [], iframes: [] }],
    folders: [],
    activePagePath: path,
    activePageSource: source,
    activePageLinks: [],
    activePageBacklinks: [],
    activePageIframes: [],
    activePageIframeBacklinks: [],
    activePageContentHash: hash
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function saved(projectSnapshot: FractalProject): FractalConditionalWriteResult {
  return {
    status: "saved",
    project: projectSnapshot
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
    headLinksHtml: "",
    headLinksHash: "head-links-hash",
    sourceHash: "source-hash",
    ...overrides
  };
}

function nativeProject(path: string, source = NATIVE_SOURCE, parts = nativeParts()): FractalProject {
  return {
    name: "Test",
    version: 2,
    rootPath: "/tmp/amanite-test",
    pages: [{ path, contentHash: parts.sourceHash, kind: "native", title: parts.title, text: "Before", links: [], iframes: [] }],
    folders: [],
    activePagePath: path,
    activePageSource: source,
    activePageLinks: [],
    activePageBacklinks: [],
    activePageIframes: [],
    activePageIframeBacklinks: [],
    activePageContentHash: parts.sourceHash,
    activePageNativeDocumentParts: parts
  };
}

describe("document persistence", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("leaves edits made during a save dirty without writing or replacing them", async () => {
    const path = "index.fractal.html";
    const firstProject = project(path, "revision one", "hash-10");
    const firstBuffer = bufferFromProject(firstProject, "revision one", true)!;
    const buffersRef = { current: { [path]: firstBuffer } as DocumentBuffers };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const publishProject = vi.fn((next: FractalProject) => { projectRef.current = next; });
    const firstWrite = deferred<FractalConditionalWriteResult>();

    vi.spyOn(fractalClient, "writeRawPageIfUnchanged")
      .mockImplementationOnce(() => firstWrite.promise);

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject });
    const saving = persistence.saveDocument(path);
    expect(persistence.saveDocument(path)).toBe(saving);
    await vi.waitFor(() => expect(fractalClient.writeRawPageIfUnchanged).toHaveBeenCalledTimes(1));

    commitBuffers((current) => ({
      ...current,
      [path]: { ...current[path], source: "revision two", dirty: true, revision: 2 }
    }));
    firstWrite.resolve(saved(project(path, "revision one", "hash-11")));

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.writeRawPageIfUnchanged).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fractalClient.writeRawPageIfUnchanged).mock.calls.map((call) => call[1])).toEqual([
      "revision one"
    ]);
    expect(buffersRef.current[path]).toMatchObject({
      contentHash: "hash-11",
      dirty: true,
      operation: null,
      revision: 2,
      source: "revision two"
    });
    expect(publishProject).not.toHaveBeenCalled();
  });

  it("rescans dirty buffers before save-all returns", async () => {
    const firstPath = "first.fractal.html";
    const secondPath = "second.fractal.html";
    const firstProject = project(firstPath, "first", "hash-10");
    const buffersRef = {
      current: {
        [firstPath]: bufferFromProject(firstProject, "first", true)!,
        [secondPath]: bufferFromProject(project(secondPath, "second", "hash-20"))!
      } as DocumentBuffers
    };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const publishProject = (next: FractalProject) => { projectRef.current = next; };
    const firstWrite = deferred<FractalConditionalWriteResult>();

    vi.spyOn(fractalClient, "writeRawPageIfUnchanged")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce(saved(project(secondPath, "second changed", "hash-21")));

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange: vi.fn(), projectRef, publishProject });
    const saving = persistence.saveAll();
    await vi.waitFor(() => expect(fractalClient.writeRawPageIfUnchanged).toHaveBeenCalledTimes(1));
    commitBuffers((current) => ({
      ...current,
      [secondPath]: { ...current[secondPath], source: "second changed", dirty: true, revision: 1 }
    }));
    firstWrite.resolve(saved(project(firstPath, "first", "hash-11")));

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.writeRawPageIfUnchanged).toHaveBeenCalledTimes(2);
    expect(buffersRef.current[secondPath]).toMatchObject({ dirty: false, source: "second changed" });
  });

  it("reports a conditional-write conflict without overwriting the page", async () => {
    const path = "index.fractal.html";
    const initialProject = project(path, "local edit", "original-hash");
    const buffersRef = {
      current: { [path]: bufferFromProject(initialProject, "local edit", true)! } as DocumentBuffers
    };
    const projectRef = { current: initialProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const writeRawPage = vi.spyOn(fractalClient, "writeRawPage");
    vi.spyOn(fractalClient, "writeRawPageIfUnchanged").mockResolvedValue({
      status: "conflict",
      message: "page changed"
    });

    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      onDocumentPathChange: vi.fn(),
      projectRef,
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(writeRawPage).not.toHaveBeenCalled();
    expect(buffersRef.current[path]).toMatchObject({ conflict: true, dirty: true, operation: null });
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
    const setPageTitle = vi.spyOn(fractalClient, "setPageTitle").mockResolvedValue(saved(savedProject));
    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, onDocumentPathChange, projectRef, publishProject: vi.fn() });

    await expect(persistence.saveDocument(path)).resolves.toBe(true);
    expect(setPageTitle).toHaveBeenCalledWith(initialProject, "Renamed", "title-hash");
    expect(onDocumentPathChange).toHaveBeenCalledWith(path, nextPath);
    expect(buffersRef.current[path]).toBeUndefined();
    expect(buffersRef.current[nextPath]).toMatchObject({ path: nextPath, dirty: false });
  });
});
