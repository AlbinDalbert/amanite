import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $getRoot, $isElementNode, type LexicalEditor } from "lexical";
import { StrictMode, act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HtmlBridgePlugin from "./HtmlBridgePlugin";
import { requestEditorSnapshot } from "./editorFlush";
import type { SharedDocumentEditorSession } from "./sharedDocumentEditor";

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
    let firstRequestId = "";
    await act(async () => {
      snapshot = await requestEditorSnapshot("amanite-document-snapshot-contract", 1);
      firstRequestId = snapshot?.requestId ?? "";
    });
    expect(snapshot).toMatchObject({ bodyHtml: "<p><span>One changed</span></p>", revision: 1 });
    expect(onSnapshot).toHaveBeenCalledWith(snapshot);
    expect(onChange).toHaveBeenCalledWith("<p><span>One changed</span></p>");
    const cached = await requestEditorSnapshot("amanite-document-snapshot-contract", 1);
    expect(cached).toMatchObject({ bodyHtml: "<p><span>One changed</span></p>", revision: 1 });
    expect(cached?.requestId).not.toBe(firstRequestId);

    await act(async () => root.unmount());
  });

  it("does not re-export a saved editor during cleanup", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onSnapshot = vi.fn();
    const revision = { current: 0 };
    const sharedSession = {
      initialized: false,
      needsSourceRefresh: false,
      getMirrorHtml: () => "<p>One</p>",
      getRevision: () => revision.current,
      nextRevision: () => ++revision.current,
      acceptBodyHtml: vi.fn(),
      markInitialized: vi.fn()
    } as unknown as SharedDocumentEditorSession;

    await act(async () => {
      root.render(
        <LexicalComposer initialConfig={{ namespace: "cleanup-snapshot-test", onError: (error) => { throw error; } }}>
          <HtmlBridgePlugin
            bodyHtml="<p>One</p>"
            documentId="amanite-document-cleanup-snapshot"
            onChange={() => {}}
            onRevision={() => {}}
            onSnapshot={onSnapshot}
            pagePath="notes.fractal.html"
            sharedSession={sharedSession}
          />
        </LexicalComposer>
      );
    });
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 30)); });

    revision.current = 1;
    const first = await requestEditorSnapshot("amanite-document-cleanup-snapshot", 1);
    expect(first).toMatchObject({ revision: 1 });
    revision.current = 2;
    const second = await requestEditorSnapshot("amanite-document-cleanup-snapshot", 2);
    expect(second).toMatchObject({ revision: 2 });
    expect(onSnapshot).toHaveBeenCalledTimes(2);

    revision.current = 3;
    await act(async () => root.unmount());
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });
});

it("ignores delayed snapshot echoes and imports only an explicit source replacement", async () => {
  const { acquireSharedDocumentEditor, releaseSharedDocumentEditor, disposeSharedDocumentEditors, SharedLexicalComposer } = await import("./sharedDocumentEditor");
  const session = acquireSharedDocumentEditor("snapshot-echo-regression", 927, "<p>Before</p>");
  const root = createRoot(document.createElement("div"));
  const loaded = vi.fn();
  const render = (bodyHtml: string, sourceIncarnation = 1) => root.render(
    <SharedLexicalComposer session={session}>
      <HtmlBridgePlugin bodyHtml={bodyHtml} sourceIncarnation={sourceIncarnation} sharedSession={session} documentId={session.documentId} pagePath="notes.fractal.html" onLoaded={loaded} />
    </SharedLexicalComposer>
  );
  const append = async (text: string) => act(async () => session.editor.update(() => {
    const paragraph = $getRoot().getFirstChild();
    if ($isElementNode(paragraph)) paragraph.append($createTextNode(text));
  }));
  try {
    await act(async () => render("<p>Before</p>"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await append(" one");
    const older = await requestEditorSnapshot(session.documentId, 1);
    await append(" two");
    const newer = await requestEditorSnapshot(session.documentId, 2);
    expect(newer?.bodyHtml).toContain("Before one two");
    await act(async () => render(older!.bodyHtml));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(session.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Before one two");
    expect(loaded).toHaveBeenCalledTimes(1);
    await act(async () => render("<p>External reload</p>", 2));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(session.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("External reload");
    expect(loaded).toHaveBeenCalledTimes(2);
    await act(async () => render("<p>External reload</p>", 3));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await append(" edited");
    const afterReload = await requestEditorSnapshot(session.documentId, session.getRevision());
    expect(afterReload).toMatchObject({ incarnation: 3, bodyHtml: "<p><span>External reload edited</span></p>" });
  } finally {
    await act(async () => root.unmount());
    releaseSharedDocumentEditor(session);
    disposeSharedDocumentEditors(927);
  }
});
