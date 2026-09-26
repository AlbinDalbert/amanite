import { afterEach, describe, expect, it, vi } from "vitest";
import type { FractalLoadedPage } from "@/lib/fractal/types";
import { bufferFromLoadedPage, type DocumentBuffers } from "./documentBuffers";
import { DocumentRecoveryCoordinator, RECOVERY_IDLE_DELAY_MS, RECOVERY_RETRY_DELAYS_MS } from "./documentRecovery";
import { DocumentRegistry } from "./documentRuntime";

const protectedSource = "<!doctype html><html><head><title>Protected</title></head><body><main data-fractal-document><h1 data-fractal-title>Protected</h1><p class=\"keep-me\">Before</p></main></body></html>";

function protectedBuffer(projectGeneration: number) {
  const loaded: FractalLoadedPage = {
    path: "protected.fractal.html",
    source: protectedSource,
    links: [],
    backlinks: [],
    contentHash: "protected-source",
    nativeDocumentParts: null
  };
  return {
    ...bufferFromLoadedPage(loaded, protectedSource, true, { projectGeneration, revision: 1 }),
    revision: 1
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("document recovery coordinator", () => {
  it("schedules protected registry sessions without autosaving them", async () => {
    vi.useFakeTimers();
    const projectGeneration = 61;
    const buffer = protectedBuffer(projectGeneration)!;
    const buffersRef = { current: { [buffer.path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(buffer.path, {
      bodyHtml: "<p class=\"keep-me\">Before</p>",
      initialRevision: 1,
      title: "Protected"
    });
    const writeDraft = vi.fn(async () => ({ revision: 1, status: "written" as const }));
    const autosave = vi.fn(async () => true);
    const coordinator = new DocumentRecoveryCoordinator({
      autoSave: true,
      autosave,
      buffersRef,
      documentRegistry: registry,
      writeDraft
    });

    try {
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);

      expect(writeDraft).toHaveBeenCalledWith(session, 1);
      expect(autosave).not.toHaveBeenCalled();
    } finally {
      coordinator.dispose();
      registry.dispose();
    }
  });

  it("retries a failed protected recovery and stops after the session closes", async () => {
    vi.useFakeTimers();
    const projectGeneration = 62;
    const buffer = protectedBuffer(projectGeneration)!;
    const buffersRef = { current: { [buffer.path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(buffer.path, {
      bodyHtml: "<p class=\"keep-me\">Before</p>",
      initialRevision: 1,
      title: "Protected"
    });
    const writeDraft = vi.fn()
      .mockRejectedValueOnce(new Error("temporary recovery failure"))
      .mockResolvedValueOnce({ revision: 1, status: "written" as const });
    const failed = vi.fn();
    const coordinator = new DocumentRecoveryCoordinator({
      buffersRef,
      documentRegistry: registry,
      onDraftError: failed,
      writeDraft
    });

    try {
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);
      expect(failed).toHaveBeenCalledWith(buffer.documentId, "temporary recovery failure");

      await vi.advanceTimersByTimeAsync(RECOVERY_RETRY_DELAYS_MS[0]);
      expect(writeDraft).toHaveBeenCalledTimes(2);

      writeDraft.mockRejectedValueOnce(new Error("failure before close"));
      session.setTitle("Pending recovery");
      buffersRef.current[buffer.path] = { ...buffer, dirty: true, revision: 2 };
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS);
      expect(writeDraft).toHaveBeenCalledTimes(3);

      registry.close(session.documentId);
      await vi.advanceTimersByTimeAsync(RECOVERY_RETRY_DELAYS_MS[0]);
      expect(writeDraft).toHaveBeenCalledTimes(3);
    } finally {
      coordinator.dispose();
      registry.dispose();
    }
  });

  it("does not resurrect a recovery draft while disk reload is resolving", async () => {
    vi.useFakeTimers();
    const projectGeneration = 63;
    const buffer = { ...protectedBuffer(projectGeneration)!, operation: "load" as const };
    const buffersRef = { current: { [buffer.path]: buffer } as DocumentBuffers };
    const registry = new DocumentRegistry({ projectGeneration });
    const { session } = registry.openLoaded(buffer.path, {
      bodyHtml: "<p class=\"keep-me\">Before</p>",
      initialRevision: 1,
      title: "Protected"
    });
    const writeDraft = vi.fn(async () => ({ revision: 1, status: "written" as const }));
    const coordinator = new DocumentRecoveryCoordinator({ buffersRef, documentRegistry: registry, writeDraft });

    try {
      await vi.advanceTimersByTimeAsync(RECOVERY_IDLE_DELAY_MS + RECOVERY_RETRY_DELAYS_MS[0]);
      expect(writeDraft).not.toHaveBeenCalled();
      expect(session.getSnapshot().revision).toBe(1);
    } finally {
      coordinator.dispose();
      registry.dispose();
    }
  });
});
