import { useEffect, useRef } from "react";
import type { FractalLink } from "@/lib/fractal/types";

type Props = {
  links: FractalLink[];
  pagePath: string;
  source: string;
  onEditSource: () => void;
  onNavigatePage: (pagePath: string) => void;
  onToggleInspector: () => void;
};

function RenderedHtmlPage({ links, pagePath, source, onEditSource, onNavigatePage, onToggleInspector }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    function handleLoad() {
      const document = frame?.contentDocument;
      if (!document) return;

      document.addEventListener("click", (event) => {
        const target = event.target;
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
    }

    frame.addEventListener("load", handleLoad);
    return () => frame.removeEventListener("load", handleLoad);
  }, [links, onNavigatePage, source]);

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
