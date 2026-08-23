import type { PointerEvent } from "react";
import type { FractalBacklink, FractalIframe, FractalIframeBacklink, FractalLink } from "@/lib/fractal/types";
import InspectorSection from "./InspectorSection";

type InspectorPanelProps = {
  backlinks: FractalBacklink[];
  iframeBacklinks: FractalIframeBacklink[];
  iframes: FractalIframe[];
  links: FractalLink[];
  outline: Array<{ index: number; label: string; level: number }>;
  onNavigateHeading: (index: number) => void;
  onNavigatePage: (pagePath: string) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
};

function iframeLabel(iframe: FractalIframe) {
  return iframe.title?.trim() || iframe.src?.trim() || (iframe.target.kind === "inline" ? "Inline document" : "Untitled iframe");
}

function InspectorPanel({ backlinks, iframeBacklinks, iframes, links, outline, onNavigateHeading, onNavigatePage, onResizeReset, onResizeStart }: InspectorPanelProps) {
  const internalLinks = links.filter((link) => link.target.kind === "internal");
  const brokenLinks = links.filter((link) => link.target.kind === "broken");

  return (
    <aside className="fractal-inspector" aria-label="Page links">
      <div aria-label="Resize link inspector" className="inspector-resize-handle" onDoubleClick={onResizeReset} onPointerDown={onResizeStart} role="separator" />
      <section className="fractal-inspector-card">
        <p className="fractal-inspector-kicker">References</p>
        <dl className="fractal-stats">
          <div><dt>Outgoing</dt><dd>{internalLinks.length}</dd></div>
          <div><dt>Incoming</dt><dd>{backlinks.length}</dd></div>
          <div><dt>Embeds</dt><dd>{iframes.length}</dd></div>
        </dl>
      </section>
      <InspectorSection
        emptyLabel="No headings."
        items={outline.map((heading) => ({ label: `${"· ".repeat(Math.max(0, heading.level - 1))}${heading.label}`, onSelect: () => onNavigateHeading(heading.index) }))}
        title="Outline"
      />
      {internalLinks.length ? <InspectorSection
        emptyLabel="No internal links."
        items={internalLinks.map((link) => ({
          label: link.text || link.href,
          onSelect: () => onNavigatePage(link.target.value)
        }))}
        title="Outgoing"
      /> : null}
      {backlinks.length ? <InspectorSection
        emptyLabel="No backlinks."
        items={backlinks.map((link) => ({
          label: link.text || link.page,
          onSelect: () => onNavigatePage(link.page)
        }))}
        title="Backlinks"
      /> : null}
      {iframes.length ? <InspectorSection
        emptyLabel="No embedded documents."
        items={iframes.map((iframe) => {
          const target = iframe.target.kind === "internal" ? iframe.target.value : null;
          return {
            label: iframeLabel(iframe),
            onSelect: target ? () => onNavigatePage(target) : undefined
          };
        })}
        title="Iframes"
      /> : null}
      {iframeBacklinks.length ? <InspectorSection
        emptyLabel="This file is not embedded by another page."
        items={iframeBacklinks.map((backlink) => ({
          label: backlink.title?.trim() || backlink.page,
          onSelect: () => onNavigatePage(backlink.page)
        }))}
        title="Embedded by"
      /> : null}
      {brokenLinks.length || iframes.some((iframe) => iframe.target.kind === "broken" || iframe.target.kind === "missing") ? <InspectorSection
        emptyLabel="No broken links."
        items={[
          ...brokenLinks.map((link) => ({ label: link.href })),
          ...iframes.filter((iframe) => iframe.target.kind === "broken" || iframe.target.kind === "missing").map((iframe) => ({ label: iframeLabel(iframe) }))
        ]}
        title="Broken"
      /> : null}
      {!internalLinks.length && !backlinks.length && !iframes.length && !iframeBacklinks.length && !brokenLinks.length ? <p className="inspector-empty-summary">No links or embeds on this page.</p> : null}
    </aside>
  );
}

export default InspectorPanel;
