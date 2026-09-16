import { $createParagraphNode, $createTextNode, $getRoot, UNDO_COMMAND } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { DocumentRegistry, type DocumentId } from "./documentRuntime";

function textOf(documentId: DocumentId, registry: DocumentRegistry) {
  return registry.getById(documentId)?.editor.getEditorState().read(() => $getRoot().getTextContent());
}

describe("document runtime", () => {
  it("deduplicates concurrent opens and keeps the document id separate from its path", async () => {
    const registry = new DocumentRegistry({ projectGeneration: 7 });
    let loadCount = 0;
    let releaseLoad!: () => void;
    const load = vi.fn(() => new Promise<{ title: string; bodyHtml: string }>((resolve) => {
      loadCount += 1;
      releaseLoad = () => resolve({ title: "Notes", bodyHtml: "<p>Initial</p>" });
    }));

    const firstOpen = registry.open("notes.fractal.html", load);
    const secondOpen = registry.open("notes.fractal.html", load);
    releaseLoad();

    const first = await firstOpen;
    const second = await secondOpen;
    expect(load).toHaveBeenCalledOnce();
    expect(loadCount).toBe(1);
    expect(second.session).toBe(first.session);
    expect(second.session.editor).toBe(first.session.editor);
    expect(first.session.documentId).not.toContain("notes.fractal.html");
    expect(first.session.getSnapshot()).toMatchObject({ path: "notes.fractal.html", projectGeneration: 7, initialized: true });
    expect(textOf(first.session.documentId, registry)).toBe("Initial");

    registry.dispose();
  });

  it("keeps title and body edits in one revision stream while capture stays read-only", async () => {
    const registry = new DocumentRegistry({ projectGeneration: 8 });
    const { session } = await registry.open("notes.fractal.html", async () => ({ title: "Notes", bodyHtml: "<p>Initial</p>" }));
    const events: string[] = [];
    const stop = session.subscribe((event) => events.push(`${event.kind}:${event.revision}`));

    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Edited"));
      $getRoot().clear().append(paragraph);
    });
    await vi.waitFor(() => expect(session.getSnapshot().revision).toBe(1));
    session.update(() => {});
    session.update(() => $getRoot().selectEnd());
    await Promise.resolve();
    expect(session.getSnapshot().revision).toBe(1);
    expect(session.setTitle("Renamed")).toBe(2);

    const beforeCapture = session.getSnapshot();
    const capture = session.capture();
    expect(capture).toMatchObject({ documentId: session.documentId, path: "notes.fractal.html", title: "Renamed", revision: 2 });
    expect(capture.editorState).toBe(session.editor.getEditorState());
    expect(session.getSnapshot()).toEqual(beforeCapture);
    expect(events).toEqual(["body:1", "title:2"]);

    stop();
    registry.dispose();
  });

  it("keeps Lexical history with the session and clears it only for explicit replacement", async () => {
    const registry = new DocumentRegistry({ projectGeneration: 9 });
    const { session } = await registry.open("notes.fractal.html", async () => ({ title: "Notes", bodyHtml: "<p>Initial</p>" }));

    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("First"));
      $getRoot().clear().append(paragraph);
    }, { discrete: true, tag: "history-push" });
    session.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Second"));
      $getRoot().clear().append(paragraph);
    }, { discrete: true, tag: "history-push" });
    await vi.waitFor(() => expect(textOf(session.documentId, registry)).toBe("Second"));
    session.editor.dispatchCommand(UNDO_COMMAND, undefined);
    await vi.waitFor(() => expect(textOf(session.documentId, registry)).toBe("First"));

    session.replaceBodyHtml("<p>Replacement</p>");
    expect(textOf(session.documentId, registry)).toBe("Replacement");
    expect(session.historyState.undoStack).toEqual([]);
    expect(session.historyState.redoStack).toEqual([]);
    expect(session.getSnapshot().replacementGeneration).toBe(2);

    registry.dispose();
  });

  it("renames the path without changing the session and closes it explicitly", async () => {
    const firstRegistry = new DocumentRegistry({ projectGeneration: 10 });
    const { session } = await firstRegistry.open("old.fractal.html", async () => ({ title: "Notes", bodyHtml: "<p>Notes</p>" }));
    const documentId = session.documentId;

    firstRegistry.rename(documentId, "new.fractal.html");
    expect(firstRegistry.getByPath("old.fractal.html")).toBeUndefined();
    expect(firstRegistry.getByPath("new.fractal.html")).toBe(session);
    expect(session.getSnapshot()).toMatchObject({ documentId, path: "new.fractal.html", projectGeneration: 10 });

    expect(firstRegistry.close(documentId)).toBe(true);
    expect(firstRegistry.size).toBe(0);
    expect(session.getSnapshot().disposed).toBe(true);
    expect(() => session.capture()).toThrow("has been disposed");

    const reopenedRegistry = new DocumentRegistry({ projectGeneration: 11 });
    const reopened = await reopenedRegistry.open("new.fractal.html", async () => ({ title: "Notes", bodyHtml: "<p>Notes</p>" }));
    expect(reopened.session.documentId).not.toBe(documentId);
    expect(reopened.session.projectGeneration).toBe(11);
    reopenedRegistry.dispose();
  });
});
