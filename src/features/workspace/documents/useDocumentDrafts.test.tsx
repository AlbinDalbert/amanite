import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { FractalLoadedPage } from "@/lib/fractal/types";
import { invoke } from "@tauri-apps/api/core";
import { requestEditorSnapshot } from "@/features/editor/components/editorFlush";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bufferFromLoadedPage, type DocumentBuffers } from "./documentBuffers";
import { AUTOSAVE_IDLE_DELAY_MS, RECOVERY_IDLE_DELAY_MS, RECOVERY_MAX_LAG_MS, RECOVERY_RETRY_DELAYS_MS, useDocumentDrafts } from "./useDocumentDrafts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/features/editor/components/editorFlush", () => ({ requestEditorSnapshot: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);
const mockedSnapshot = vi.mocked(requestEditorSnapshot);
const SOURCE = "<!doctype html><html><head><title>Notes</title></head><body><main data-fractal-document><p>Before</p></main></body></html>";

function dirtyBuffer(revision: number, draftedRevision = 0) {
  const loaded: FractalLoadedPage = { path: "notes.fractal.html", source: SOURCE, links: [], backlinks: [], contentHash: "base", nativeDocumentParts: null };
  const buffer = bufferFromLoadedPage(loaded)!;
  return { ...buffer, dirty: true, draftedRevision, revision };
}

function snapshot(buffer: ReturnType<typeof dirtyBuffer>, revision: number, bodyHtml: string) {
  return { bodyHtml, documentId: buffer.documentId, incarnation: 1, projectGeneration: buffer.projectGeneration, requestId: `test-${revision}`, revision };
}

function Harness({ buffers, autoSave = false, onDraftConfirmed, onDraftError }: { buffers: DocumentBuffers; autoSave?: boolean; onDraftConfirmed: (documentId: string, revision: number) => void; onDraftError?: (documentId: string, message: string) => void }) {
  useDocumentDrafts({
    autoSave,
    buffers,
    projectRoot: "/tmp/draft-hook",
    saveDocument: vi.fn(async () => true),
    onDraftConfirmed,
    onDraftError,
    onStorageError: vi.fn()
  });
  useEffect(() => undefined, []);
  return null;
}

describe("revision-aware document drafts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    mockedInvoke.mockResolvedValue(undefined);
    const buffer = dirtyBuffer(1);
    mockedSnapshot.mockResolvedValue(snapshot(buffer, 1, "<p>Edited</p>"));
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("confirms one checkpoint and does not draft the unchanged revision again", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const confirmed = vi.fn();
    const buffer = dirtyBuffer(1);
    await act(async () => root.render(<Harness buffers={{ [buffer.path]: buffer }} onDraftConfirmed={confirmed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS); });
    expect(mockedSnapshot).toHaveBeenCalledWith(buffer.documentId, 1);
    expect(mockedInvoke).toHaveBeenCalledWith("fractal_write_draft", { draft: expect.objectContaining({ revision: 1, source: expect.stringContaining("Edited") }) });
    expect(confirmed).toHaveBeenCalledWith(buffer.documentId, 1);

    await act(async () => root.render(<Harness buffers={{ [buffer.path]: { ...buffer, draftedRevision: 1 } }} onDraftConfirmed={confirmed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_MAX_LAG_MS + AUTOSAVE_IDLE_DELAY_MS); });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("uses the maximum lag timer while revisions keep arriving", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const confirmed = vi.fn();
    const first = dirtyBuffer(1);
    mockedSnapshot.mockResolvedValue(snapshot(first, 3, "<p>Latest</p>"));
    await act(async () => root.render(<Harness buffers={{ [first.path]: first }} onDraftConfirmed={confirmed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const second = { ...first, revision: 2 };
    await act(async () => root.render(<Harness buffers={{ [second.path]: second }} onDraftConfirmed={confirmed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    const third = { ...first, revision: 3 };
    await act(async () => root.render(<Harness buffers={{ [third.path]: third }} onDraftConfirmed={confirmed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_MAX_LAG_MS - 200 + 20); });

    expect(mockedSnapshot).toHaveBeenCalledWith(first.documentId, 3);
    expect(confirmed).toHaveBeenCalledWith(first.documentId, 3);
    await act(async () => root.unmount());
  });

  it("retries a transient failure without requiring another edit", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const confirmed = vi.fn();
    const failed = vi.fn();
    const buffer = dirtyBuffer(1);
    mockedInvoke.mockRejectedValueOnce(new Error("temporary storage failure")).mockResolvedValue(undefined);
    await act(async () => root.render(<Harness buffers={{ [buffer.path]: buffer }} onDraftConfirmed={confirmed} onDraftError={failed} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS); });
    expect(failed).toHaveBeenCalledWith(buffer.documentId, "temporary storage failure");

    await act(async () => { await vi.advanceTimersByTimeAsync(RECOVERY_RETRY_DELAYS_MS[0]); });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(confirmed).toHaveBeenCalledWith(buffer.documentId, 1);
    await act(async () => root.unmount());
  });
});
