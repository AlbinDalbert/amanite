import { describe, expect, it } from "vitest";
import { createProjectGeneration, documentIdentity, isSameProjectSession } from "./documentSessions";

describe("document session identity", () => {
  it("keeps a document identity stable while its path changes", () => {
    const generation = createProjectGeneration();
    const before = documentIdentity(generation, "notes.fractal.html");
    const after = { ...before, documentId: before.documentId };

    expect(after.documentId).toBe(before.documentId);
    expect(after.projectGeneration).toBe(generation);
  });

  it("separates reopened project sessions even when the root is unchanged", () => {
    const first = { documentId: documentIdentity(10, "notes.fractal.html").documentId, projectGeneration: 10 };
    const reopened = { documentId: documentIdentity(11, "notes.fractal.html").documentId, projectGeneration: 11 };

    expect(isSameProjectSession(first, reopened)).toBe(false);
    expect(first.documentId).not.toBe(reopened.documentId);
  });
});
