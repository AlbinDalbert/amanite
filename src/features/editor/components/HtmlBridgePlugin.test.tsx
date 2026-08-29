import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HtmlBridgePlugin from "./HtmlBridgePlugin";

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
});
