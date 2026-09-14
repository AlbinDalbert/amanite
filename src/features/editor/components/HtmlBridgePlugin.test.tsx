import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $getRoot, $isElementNode, type LexicalEditor } from "lexical";
import { StrictMode, act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HtmlBridgePlugin from "./HtmlBridgePlugin";
import { requestEditorSnapshot } from "./editorFlush";

function CaptureEditor({ onCapture }: { onCapture: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onCapture(editor), [editor, onCapture]);
  return null;
}

describe("HTML bridge loading", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("finishes a batched import after Strict Mode restarts its effect", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onLoaded = vi.fn();

    await act(async () => {
      root.render(
        <StrictMode>
          <LexicalComposer initialConfig={{ namespace: "strict-loading-test", onError: (error) => { throw error; } }}>
            <HtmlBridgePlugin
              bodyHtml="<p>One</p><p>Two</p>"
              onChange={() => {}}
              onLoaded={onLoaded}
              pagePath="notes.fractal.html"
            />
          </LexicalComposer>
        </StrictMode>
      );
    });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 30)); });

    expect(onLoaded).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("reports revisions immediately and exports only for an explicit snapshot", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();
    const onRevision = vi.fn();
    const onSnapshot = vi.fn();
    let editor: LexicalEditor | null = null;

    await act(async () => {
      root.render(
        <LexicalComposer initialConfig={{ namespace: "snapshot-contract-test", onError: (error) => { throw error; } }}>
          <CaptureEditor onCapture={(captured) => { editor = captured; }} />
          <HtmlBridgePlugin
            bodyHtml="<p>One</p>"
            documentId="amanite-document-snapshot-contract"
            onChange={onChange}
            onRevision={onRevision}
            onSnapshot={onSnapshot}
            pagePath="notes.fractal.html"
          />
        </LexicalComposer>
      );
    });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 30)); });
    expect(editor).not.toBeNull();

    await act(async () => {
      editor?.update(() => {
        const paragraph = $getRoot().getFirstChild();
        if ($isElementNode(paragraph)) paragraph.append($createTextNode(" changed"));
      });
    });

    expect(onRevision).toHaveBeenCalledWith(1);
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    let snapshot;
    await act(async () => { snapshot = await requestEditorSnapshot("amanite-document-snapshot-contract", 1); });
    expect(snapshot).toMatchObject({ bodyHtml: "<p><span>One changed</span></p>", revision: 1 });
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    expect(onChange).toHaveBeenCalledWith("<p><span>One changed</span></p>");

    await act(async () => root.unmount());
  });
});
