import type { FractalBacklink, FractalIframe, FractalIframeBacklink, FractalLink } from "@/lib/fractal/types";
import InspectorSection from "./InspectorSection";

type InspectorPanelProps = {
  backlinks: FractalBacklink[];
  iframeBacklinks: FractalIframeBacklink[];
  iframes: FractalIframe[];
  links: FractalLink[];
  onNavigatePage: (pagePath: string) => void;
};

function iframeLabel(iframe: FractalIframe) {
  return iframe.title?.trim() || iframe.src?.trim() || (iframe.target.kind === "inline" ? "Inline document" : "Untitled iframe");
}

function InspectorPanel({ backlinks, iframeBacklinks, iframes, links, onNavigatePage }: InspectorPanelProps) {
  const internalLinks = links.filter((link) => link.target.kind === "internal");
  const brokenLinks = links.filter((link) => link.target.kind === "broken");

  return (
    <aside className="fractal-inspector" aria-label="Page links">
      <section className="fractal-inspector-card">
        <p className="fractal-inspector-kicker">References</p>
        <dl className="fractal-stats">
          <div><dt>Outgoing</dt><dd>{internalLinks.length}</dd></div>
          <div><dt>Incoming</dt><dd>{backlinks.length}</dd></div>
          <div><dt>Embeds</dt><dd>{iframes.length}</dd></div>
        </dl>
      </section>
      <InspectorSection
        emptyLabel="No internal links."
        items={internalLinks.map((link) => ({
          label: link.text || link.href,
          onSelect: () => onNavigatePage(link.target.value)
        }))}
        title="Outgoing"
      />
      <InspectorSection
        emptyLabel="No backlinks."
        items={backlinks.map((link) => ({
          label: link.text || link.page,
          onSelect: () => onNavigatePage(link.page)
        }))}
        title="Backlinks"
      />
      <InspectorSection
        emptyLabel="No embedded documents."
        items={iframes.map((iframe) => {
          const target = iframe.target.kind === "internal" ? iframe.target.value : null;
          return {
            label: iframeLabel(iframe),
            onSelect: target ? () => onNavigatePage(target) : undefined
          };
        })}
        title="Iframes"
      />
      <InspectorSection
        emptyLabel="This file is not embedded by another page."
        items={iframeBacklinks.map((backlink) => ({
          label: backlink.title?.trim() || backlink.page,
          onSelect: () => onNavigatePage(backlink.page)
        }))}
        title="Embedded by"
      />
      <InspectorSection
        emptyLabel="No broken links."
        items={[
          ...brokenLinks.map((link) => ({ label: link.href })),
          ...iframes.filter((iframe) => iframe.target.kind === "broken" || iframe.target.kind === "missing").map((iframe) => ({ label: iframeLabel(iframe) }))
        ]}
        title="Broken"
      />
    </aside>
  );
}

export default InspectorPanel;
