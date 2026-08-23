import type { PointerEvent } from "react";
import type { FractalBacklink, FractalDerivedLink, FractalIframe, FractalIframeBacklink, FractalLink, FractalLinkSuggestion } from "@/lib/fractal/types";
import InspectorSection from "./InspectorSection";

type InspectorPanelProps = {
  backlinks: FractalBacklink[];
  derivedLinks: FractalDerivedLink[];
  iframeBacklinks: FractalIframeBacklink[];
  iframes: FractalIframe[];
  links: FractalLink[];
  linkSuggestions: FractalLinkSuggestion[];
  outline: Array<{ index: number; label: string; level: number }>;
  onInsertSuggestedLink: (text: string, target: string) => void;
  onNavigateHeading: (index: number) => void;
  onNavigatePage: (pagePath: string) => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
};

function iframeLabel(iframe: FractalIframe) {
  return iframe.title?.trim() || iframe.src?.trim() || (iframe.target.kind === "inline" ? "Inline document" : "Untitled iframe");
}

function InspectorPanel({ backlinks, derivedLinks, iframeBacklinks, iframes, links, linkSuggestions, outline, onInsertSuggestedLink, onNavigateHeading, onNavigatePage, onResizeReset, onResizeStart }: InspectorPanelProps) {
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
          <div><dt>Derived</dt><dd>{derivedLinks.length}</dd></div>
        </dl>
      </section>
      <InspectorSection
        emptyLabel="No headings."
        items={outline.map((heading) => ({ label: `${"· ".repeat(Math.max(0, heading.level - 1))}${heading.label}`, onSelect: () => onNavigateHeading(heading.index) }))}
        title="Outline"
      />
      <InspectorSection
        emptyLabel="No derived links."
        items={derivedLinks.map((link) => ({ label: `${link.text} → ${link.target}`, onSelect: () => onNavigatePage(link.target) }))}
        title="Derived links"
      />
      <section className="fractal-inspector-section link-suggestions">
        <h3>Link suggestions</h3>
        {linkSuggestions.length ? <ul>{linkSuggestions.map((suggestion) => {
          const candidate = suggestion.candidates[0];
          return candidate ? <li key={`${suggestion.text}:${candidate.page}`}><button onClick={() => onInsertSuggestedLink(suggestion.text, candidate.page)} type="button"><span>{suggestion.text}</span><small>Link to {candidate.title}</small></button></li> : null;
        })}</ul> : <p>No link suggestions.</p>}
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
