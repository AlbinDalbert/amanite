import { describe, expect, it, vi } from "vitest";
import { registerEditorFlush, requestEditorFlush } from "./editorFlush";

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
});
