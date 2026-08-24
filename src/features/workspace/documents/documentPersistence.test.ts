import { beforeEach, describe, expect, it, vi } from "vitest";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalConditionalWriteResult, FractalProject } from "@/lib/fractal/types";
import { bufferFromProject, type BufferUpdater, type DocumentBuffers } from "./documentBuffers";
import { createDocumentPersistence } from "./documentPersistence";

function project(path: string, source: string, hash: string): FractalProject {
  return {
    name: "Test",
    rootPath: "/tmp/amanite-test",
    pages: [{ path, contentHash: hash, kind: "native", title: "Test", text: "", links: [], iframes: [] }],
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

describe("document persistence", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("flushes edits made while a save is in flight before reporting success", async () => {
    const path = "index.fractal.html";
    const firstProject = project(path, "revision one", "hash-10");
    const firstBuffer = bufferFromProject(firstProject, "revision one", true)!;
    const buffersRef = { current: { [path]: firstBuffer } as DocumentBuffers };
    const projectRef = { current: firstProject };
    const commitBuffers = (updater: BufferUpdater) => { buffersRef.current = updater(buffersRef.current); };
    const publishProject = (next: FractalProject) => { projectRef.current = next; };
    const firstWrite = deferred<FractalConditionalWriteResult>();

    vi.spyOn(fractalClient, "writePageIfUnchanged")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce({ status: "saved", project: project(path, "revision two", "hash-12") });

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, projectRef, publishProject });
    const saving = persistence.saveDocument(path);
    expect(persistence.saveDocument(path)).toBe(saving);
    await vi.waitFor(() => expect(fractalClient.writePageIfUnchanged).toHaveBeenCalledTimes(1));

    commitBuffers((current) => ({
      ...current,
      [path]: { ...current[path], source: "revision two", dirty: true, revision: 2 }
    }));
    firstWrite.resolve({ status: "saved", project: project(path, "revision one", "hash-11") });

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.writePageIfUnchanged).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fractalClient.writePageIfUnchanged).mock.calls.map((call) => call[1])).toEqual([
      "revision one",
      "revision two"
    ]);
    expect(buffersRef.current[path]).toMatchObject({ dirty: false, source: "revision two" });
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

    vi.spyOn(fractalClient, "writePageIfUnchanged")
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValueOnce({ status: "saved", project: project(secondPath, "second changed", "hash-21") });

    const persistence = createDocumentPersistence({ buffersRef, commitBuffers, projectRef, publishProject });
    const saving = persistence.saveAll();
    await vi.waitFor(() => expect(fractalClient.writePageIfUnchanged).toHaveBeenCalledTimes(1));
    commitBuffers((current) => ({
      ...current,
      [secondPath]: { ...current[secondPath], source: "second changed", dirty: true, revision: 1 }
    }));
    firstWrite.resolve({ status: "saved", project: project(firstPath, "first", "hash-11") });

    await expect(saving).resolves.toBe(true);
    expect(fractalClient.writePageIfUnchanged).toHaveBeenCalledTimes(2);
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
    const writePage = vi.spyOn(fractalClient, "writePage");
    vi.spyOn(fractalClient, "writePageIfUnchanged").mockResolvedValue({
      status: "conflict",
      message: "page changed"
    });

    const persistence = createDocumentPersistence({
      buffersRef,
      commitBuffers,
      projectRef,
      publishProject: vi.fn()
    });

    await expect(persistence.saveDocument(path)).resolves.toBe(false);
    expect(writePage).not.toHaveBeenCalled();
    expect(buffersRef.current[path]).toMatchObject({ conflict: true, dirty: true, operation: null });
  });
});
