import { registerHistory } from "@lexical/history";
import { $createParagraphNode, $createTextNode, $getRoot, UNDO_COMMAND } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { acquireSharedDocumentEditor } from "./sharedDocumentEditor";

describe("shared document editor sessions", () => {
  it("shares one Lexical model and mirror across views", async () => {
    const first = acquireSharedDocumentEditor("amanite-document-test-shared", 42, "<p>Initial</p>", "left");
    const second = acquireSharedDocumentEditor("amanite-document-test-shared", 42, "<p>Ignored seed</p>", "right");

    expect(second.editor).not.toBe(first.editor);
    expect(second.historyState).toBe(first.historyState);
    expect(first.viewCount).toBe(2);
    first.markInitialized();

    first.editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Shared edit"));
      $getRoot().clear().append(paragraph);
      // The session is the authority, so both view handles observe this same update.
    });

    await vi.waitFor(() => expect(second.editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("Shared edit"));
    await vi.waitFor(() => expect(first.getModel(undefined, first.getRevision() + 1).text).toContain("Shared edit"));
    expect(second.getModel().text).toBe(first.getModel().text);

    first.releaseView();
    second.releaseView();
    first.dispose();
  });

  it("keeps history alive while control moves between views", async () => {
    const first = acquireSharedDocumentEditor("amanite-document-history", 42, "<p>Initial</p>", "left");
    const second = acquireSharedDocumentEditor("amanite-document-history", 42, "<p>Initial</p>", "right");
    const unregisterFirst = registerHistory(first.editor, first.historyState, 0);
    first.markInitialized();

    first.editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Baseline"));
      $getRoot().clear().append(paragraph);
    }, { discrete: true, tag: "history-push" });
    first.editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Before undo"));
      $getRoot().clear().append(paragraph);
    }, { discrete: true, tag: "history-push" });
    await vi.waitFor(() => expect(second.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Before undo"));
    unregisterFirst();
    const unregisterSecond = registerHistory(second.editor, second.historyState, 0);
    second.editor.dispatchCommand(UNDO_COMMAND, undefined);

    await vi.waitFor(() => expect(first.editor.getEditorState().read(() => $getRoot().getTextContent())).not.toBe("Before undo"));
    unregisterSecond();
    first.releaseView();
    second.releaseView();
    first.dispose();
  });

  it("advances the source incarnation without resetting revision identity", () => {
    const session = acquireSharedDocumentEditor("amanite-document-incarnation", 42, "<p>Initial</p>", "left");
    session.nextRevision();
    session.historyState.undoStack.push({ editor: session.editor, editorState: session.editor.getEditorState() });

    expect(session.replaceSource()).toBe(2);
    expect(session.getRevision()).toBe(2);
    expect(session.historyState.undoStack).toEqual([]);
    session.releaseView();
    session.dispose();
  });

  it("starts a recovered session at the buffer revision and incarnation", () => {
    const session = acquireSharedDocumentEditor("amanite-document-recovered", 42, "<p>Recovered</p>", "left", 9, 3);

    expect(session.getRevision()).toBe(9);
    expect(session.getIncarnation()).toBe(3);
    session.releaseView();
    session.dispose();
  });
});
