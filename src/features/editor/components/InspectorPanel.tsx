import type { PointerEvent } from "react";
import type { FractalBacklink, FractalLink } from "@/lib/fractal/types";
import InspectorSection from "./InspectorSection";

type InspectorPanelProps = {
  backlinks: FractalBacklink[];
  links: FractalLink[];
  outline: Array<{ index: number; label: string; level: number }>;
  onNavigateHeading: (index: number) => void;
  onNavigatePage: (pagePath: string) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
};

function InspectorPanel({ backlinks, links, outline, onNavigateHeading, onNavigatePage, onResizeReset, onResizeStart }: InspectorPanelProps) {
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
      {brokenLinks.length ? <InspectorSection
        emptyLabel="No broken links."
        items={[
          ...brokenLinks.map((link) => ({ label: link.href }))
        ]}
        title="Broken"
      /> : null}
      {!internalLinks.length && !backlinks.length && !brokenLinks.length ? <p className="inspector-empty-summary">No links on this page.</p> : null}
    </aside>
  );
}

export default InspectorPanel;
