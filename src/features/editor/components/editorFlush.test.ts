import { describe, expect, it, vi } from "vitest";
import { listenForEditorFlush, registerEditorFlush, requestEditorFlush } from "./editorFlush";

describe("editor flush coordination", () => {
  it("flushes only the requested page", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = listenForEditorFlush("first.fractal.html", first);
    const stopSecond = listenForEditorFlush("second.fractal.html", second);

    requestEditorFlush("first.fractal.html");

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
