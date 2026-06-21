import type {
  FractalGraphPageLink,
  FractalNote,
  FractalPageLink
} from "@/lib/fractal/types";
import InspectorSection from "./InspectorSection";
import { uniqueInspectorItems } from "./editorText";

type InspectorPanelProps = {
  backlinks: FractalGraphPageLink[];
  links: FractalPageLink[];
  notes: FractalNote[];
  outlinks: FractalGraphPageLink[];
};

function InspectorPanel({ backlinks, links, notes, outlinks }: InspectorPanelProps) {
  const linkItems = uniqueInspectorItems(
    links,
    (link) => link.href,
    (link) => `${link.text} -> ${link.href}`
  );
  const noteItems = notes.map((note) => `${note.label}: ${note.text || note.id}`);
  const backlinkItems = backlinks.map((link) => `${link.text} <- ${link.page}`);
  const outlinkItems = outlinks.map((link) => `${link.text} -> ${link.page}`);

  return (
    <aside className="fractal-inspector" aria-label="Fractal page context">
      <section className="fractal-inspector-card">
        <p className="fractal-inspector-kicker">Context</p>
        <dl className="fractal-stats">
          <div>
            <dt>Links</dt>
            <dd>{linkItems.length}</dd>
          </div>
          <div>
            <dt>Backlinks</dt>
            <dd>{backlinks.length}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{notes.length}</dd>
          </div>
        </dl>
      </section>

      <InspectorSection emptyLabel="No outgoing page links." items={outlinkItems} title="Outlinks" />
      <InspectorSection emptyLabel="No backlinks yet." items={backlinkItems} title="Backlinks" />
      <InspectorSection emptyLabel="No inline links." items={linkItems} title="HTML Links" />
      <InspectorSection emptyLabel="No Fractal notes." items={noteItems} title="Notes" />
    </aside>
  );
}

export default InspectorPanel;
