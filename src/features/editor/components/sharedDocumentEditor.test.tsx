import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { acquireSharedDocumentEditor } from "./sharedDocumentEditor";

describe("shared document editor sessions", () => {
  it("shares one Lexical model and mirror across views", async () => {
    const first = acquireSharedDocumentEditor("amanite-document-test-shared", 42, "<p>Initial</p>");
    const second = acquireSharedDocumentEditor("amanite-document-test-shared", 42, "<p>Ignored seed</p>");

    expect(second.editor).toBe(first.editor);
    expect(second.context).toBe(first.context);
    expect(first.viewCount).toBe(2);

    first.editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("Shared edit"));
      $getRoot().clear().append(paragraph);
      // The session is the authority, so both view handles observe this same update.
    });

    await vi.waitFor(() => expect(first.getMirrorHtml()).toContain("Shared edit"));
    expect(second.getMirrorHtml()).toBe(first.getMirrorHtml());

    first.releaseView();
    second.releaseView();
    first.dispose();
  });
});
