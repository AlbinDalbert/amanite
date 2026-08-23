import { useEffect, useRef } from "react";
import type { FractalDerivedLink, FractalLink } from "@/lib/fractal/types";

type Props = {
  links: FractalLink[];
  derivedLinks: FractalDerivedLink[];
  pagePath: string;
  source: string;
  onEditSource: () => void;
  onNavigatePage: (pagePath: string) => void;
  onToggleInspector: () => void;
};

function RenderedHtmlPage({ derivedLinks, links, pagePath, source, onEditSource, onNavigatePage, onToggleInspector }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    function handleLoad() {
      const document = frame?.contentDocument;
      if (!document) return;

      const derivedStyle = document.createElement("style");
      derivedStyle.textContent = ".amanite-derived-link { text-decoration: underline dotted; text-underline-offset: .18em; cursor: pointer; }";
      document.head.append(derivedStyle);

      const root = document.body.querySelector("main[data-fractal-document]") ?? document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
      for (const link of [...derivedLinks].sort((left, right) =>
        right.occurrence.start.text_node - left.occurrence.start.text_node || right.occurrence.start.offset - left.occurrence.start.offset
      )) {
        if (link.occurrence.start.text_node !== link.occurrence.end.text_node) continue;
        const textNode = textNodes[link.occurrence.start.text_node];
        if (!textNode || textNode.parentElement?.closest("a, script, style")) continue;
        const range = document.createRange();
        try {
          range.setStart(textNode, link.occurrence.start.offset);
          range.setEnd(textNode, link.occurrence.end.offset);
          const anchor = document.createElement("a");
          anchor.href = "#";
          anchor.dataset.amaniteDerivedTarget = link.target;
          anchor.className = "amanite-derived-link";
          anchor.title = `Open ${link.target}`;
          range.surroundContents(anchor);
        } catch {
          // A browser-normalized text node can differ from the source ordinal.
        }
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        const anchor = target instanceof Element ? target.closest("a[href]") : null;
        if (!(anchor instanceof HTMLAnchorElement)) return;

        const derivedTarget = anchor.dataset.amaniteDerivedTarget;
        if (derivedTarget) {
          event.preventDefault();
          onNavigatePage(derivedTarget);
          return;
        }

        const href = anchor.getAttribute("href") ?? "";
        const link = links.find((candidate) => candidate.href === href);
        if (link?.target.kind === "internal") {
          event.preventDefault();
          onNavigatePage(link.target.value);
        } else if (link?.target.kind === "internal_file" && link.target.value.toLowerCase().endsWith(".html")) {
          event.preventDefault();
          onNavigatePage(link.target.value);
        } else if (link?.target.kind === "external") {
          event.preventDefault();
          window.open(link.target.value, "_blank", "noopener,noreferrer");
        }
      });
    }

    frame.addEventListener("load", handleLoad);
    return () => frame.removeEventListener("load", handleLoad);
  }, [derivedLinks, links, onNavigatePage, source]);

  return (
    <section className="rendered-page-shell" aria-label="Rendered HTML page">
      <header className="rendered-page-header">
        <div>
          <span className="document-kind-badge">Preview</span>
          <p>{pagePath}</p>
        </div>
        <div className="rendered-page-actions">
          <button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button>
          <button className="source-mode-toggle" onClick={onEditSource} type="button">Edit HTML</button>
        </div>
      </header>
      <iframe
        ref={frameRef}
        className="rendered-page-frame"
        sandbox="allow-same-origin"
        srcDoc={source}
        title={`Rendered page ${pagePath}`}
      />
    </section>
  );
}

export default RenderedHtmlPage;
