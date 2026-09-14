import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearPageDraft, writePageDraftSource } from "./pageDrafts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

describe("native draft queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("coalesces obsolete writes and sends the captured revision", async () => {
    const first = writePageDraftSource("/tmp/draft-queue", "notes.fractal.html", "one", "base", 1);
    const second = writePageDraftSource("/tmp/draft-queue", "notes.fractal.html", "two", "base", 2);
    await Promise.all([first, second]);

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", {
      draft: expect.objectContaining({ pagePath: "notes.fractal.html", revision: 2, source: "two" })
    });
    await expect(second).resolves.toEqual({ revision: 2, status: "written" });
  });

  it("lets a queued clear supersede a pending checkpoint", async () => {
    const write = writePageDraftSource("/tmp/draft-clear", "notes.fractal.html", "one", "base", 1);
    const clear = clearPageDraft("/tmp/draft-clear", "notes.fractal.html");
    await Promise.all([write, clear]);

    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith("fractal_delete_draft", {
      pagePath: "notes.fractal.html",
      projectRoot: "/tmp/draft-clear"
    });
    await expect(write).resolves.toEqual({ revision: 1, status: "superseded" });
  });
});
