import { describe, expect, it, vi } from "vitest";
import { readPageDraft } from "@/app/pageDrafts";
import { resolveDocumentDraft } from "./documentDraftRecovery";

vi.mock("@/app/pageDrafts", () => ({ clearPageDraft: vi.fn(), readPageDraft: vi.fn() }));

const mockedReadDraft = vi.mocked(readPageDraft);

describe("document draft recovery", () => {
  it("preserves the confirmed draft revision when it is recovered", async () => {
    mockedReadDraft.mockResolvedValue({
      version: 1,
      projectRoot: "/tmp/project",
      pagePath: "notes.fractal.html",
      source: "draft source",
      baseSourceHash: "base",
      updatedAt: "2026-09-14T00:00:00.000Z",
      revision: 8
    });

    await expect(resolveDocumentDraft({
      checkDraft: true,
      onRequestConfirmation: vi.fn(async () => true),
      pagePath: "notes.fractal.html",
      projectRoot: "/tmp/project",
      source: "disk source",
      sourceHash: "base"
    })).resolves.toMatchObject({ dirty: true, draftedRevision: 8, revision: 8, source: "draft source" });
  });
});
