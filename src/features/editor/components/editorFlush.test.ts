import { describe, expect, it, vi } from "vitest";
import { listenForEditorFlush, requestEditorFlush } from "./editorFlush";

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
});
