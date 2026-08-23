import { useEffect, useRef } from "react";
import type { FractalLink, FractalPage } from "@/lib/fractal/types";
import { derivedPageLinkTargets, findDerivedPageLinksForTargets } from "./pageLinks";

type Props = {
  links: FractalLink[];
  pages: FractalPage[];
  pagePath: string;
  source: string;
  onEditSource: () => void;
  onNavigatePage: (pagePath: string) => void;
  onToggleInspector: () => void;
};

function RenderedHtmlPage({ links, pages, pagePath, source, onEditSource, onNavigatePage, onToggleInspector }: Props) {
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
      const derivedTargets = derivedPageLinkTargets(pagePath, pages);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let node: Node | null;
      while ((node = walker.nextNode())) textNodes.push(node as Text);
      for (const textNode of textNodes) {
        if (textNode.parentElement?.closest("a, code, pre, script, style")) continue;
        const matches = findDerivedPageLinksForTargets(textNode.data, derivedTargets);
        for (const link of matches.reverse()) {
          const range = document.createRange();
          range.setStart(textNode, link.start);
          range.setEnd(textNode, link.end);
          const linkBehavior = document.createElement("span");
          linkBehavior.dataset.amaniteDerivedTarget = link.target;
          linkBehavior.className = "amanite-derived-link";
          linkBehavior.role = "link";
          linkBehavior.tabIndex = 0;
          linkBehavior.title = `Open ${link.target}`;
          range.surroundContents(linkBehavior);
        }
      }

      document.addEventListener("click", (event) => {
        const target = event.target;
        const derivedLink = target instanceof Element ? target.closest<HTMLElement>("[data-amanite-derived-target]") : null;
        const derivedTarget = derivedLink?.dataset.amaniteDerivedTarget;
        if (derivedTarget) {
          event.preventDefault();
          onNavigatePage(derivedTarget);
          return;
        }
        const anchor = target instanceof Element ? target.closest("a[href]") : null;
        if (!(anchor instanceof HTMLAnchorElement)) return;
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

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const target = event.target;
        const derivedLink = target instanceof Element ? target.closest<HTMLElement>("[data-amanite-derived-target]") : null;
        const derivedTarget = derivedLink?.dataset.amaniteDerivedTarget;
        if (!derivedTarget) return;
        event.preventDefault();
        onNavigatePage(derivedTarget);
      });
    }

    frame.addEventListener("load", handleLoad);
    return () => frame.removeEventListener("load", handleLoad);
  }, [links, onNavigatePage, pagePath, pages, source]);

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
