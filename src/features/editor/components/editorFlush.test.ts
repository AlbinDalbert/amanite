import { describe, expect, it, vi } from "vitest";
import { registerEditorFlush, requestEditorFlush, requestEditorSnapshot } from "./editorFlush";

describe("editor flush coordination", () => {
  it("flushes only the requested registered page", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = registerEditorFlush("first.fractal.html", { flush: first });
    const stopSecond = registerEditorFlush("second.fractal.html", { flush: second });

    await requestEditorFlush("first.fractal.html");

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    stopFirst();
    stopSecond();
  });

  it("awaits registered editor barriers", async () => {
    const order: string[] = [];
    const stop = registerEditorFlush("notes.fractal.html", {
      getRevision: () => 4,
      flush: async () => {
        await Promise.resolve();
        order.push("flushed");
      }
    });

    await requestEditorFlush("notes.fractal.html");

    expect(order).toEqual(["flushed"]);
    stop();
  });

  it("selects one current controller and coalesces compatible requests", async () => {
    let resolveSnapshot!: (value: import("./editorFlush").EditorSnapshot) => void;
    const flush = vi.fn((minimumRevision = 0, requestId = "") => new Promise<import("./editorFlush").EditorSnapshot>((resolve) => {
      resolveSnapshot = resolve;
      expect(minimumRevision).toBe(4);
      expect(requestId).toMatch(/^editor-snapshot-/);
    }));
    const stopOld = registerEditorFlush("shared", { flush: vi.fn(), getRevision: () => 2 });
    const stopCurrent = registerEditorFlush("shared", { flush, getRevision: () => 4 });

    const first = requestEditorSnapshot("shared", 4);
    const second = requestEditorSnapshot("shared", 3);
    expect(second).toBe(first);
    expect(flush).toHaveBeenCalledOnce();
    const requestId = flush.mock.calls[0][1] ?? "";
    resolveSnapshot({ bodyHtml: "<p>Four</p>", documentId: "shared", incarnation: 1, projectGeneration: 7, requestId, revision: 4 });
    await expect(first).resolves.toMatchObject({ documentId: "shared", projectGeneration: 7, revision: 4 });
    stopOld();
    stopCurrent();
  });

  it("rejects a reply that does not match the requested document", async () => {
    const stop = registerEditorFlush("current", {
      getRevision: () => 5,
      flush: (_revision, requestId = "") => ({ bodyHtml: "<p>Old</p>", documentId: "replaced", incarnation: 1, projectGeneration: 1, requestId, revision: 5 })
    });
    await expect(requestEditorSnapshot("current", 5)).rejects.toThrow("obsolete document state");
    stop();
  });
});
