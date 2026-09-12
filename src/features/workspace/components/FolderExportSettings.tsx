import DerivedLinksOption from "@/components/ui/DerivedLinksOption";

type Props = {
  disabled: boolean;
  force: boolean;
  includeDerivedLinks: boolean;
  numberSections: boolean;
  onForceChange: (force: boolean) => void;
  onIncludeDerivedLinksChange: (include: boolean) => void;
  onNumberSectionsChange: (number: boolean) => void;
};

export default function FolderExportSettings({ disabled, force, includeDerivedLinks, numberSections, onForceChange, onIncludeDerivedLinksChange, onNumberSectionsChange }: Props) {
  return (
    <aside className="folder-export-settings">
      <div className="folder-export-format"><span>HTML</span><div><strong>One document</strong><small>Pages stay in Fractal order.</small></div></div>
      <fieldset className="export-options" disabled={disabled}>
        <legend>Document</legend>
        <label className="export-check-row"><input checked={numberSections} onChange={(event) => onNumberSectionsChange(event.currentTarget.checked)} type="checkbox" /><span><strong>Number sections</strong><small>Prefix page headings with 1, 2, 3…</small></span></label>
        <DerivedLinksOption checked={includeDerivedLinks} description="Turn unlinked page-title mentions into links or references." label="Include title mentions" onChange={onIncludeDerivedLinksChange} />
      </fieldset>
      <fieldset className="folder-export-validity" disabled={disabled}>
        <legend>Invalid pages</legend>
        <label className={!force ? "selected" : ""}><input checked={!force} name="invalid-pages" onChange={() => onForceChange(false)} type="radio" /><span><strong>Stop export</strong><small>Fix the page before exporting.</small></span></label>
        <label className={force ? "selected" : ""}><input checked={force} name="invalid-pages" onChange={() => onForceChange(true)} type="radio" /><span><strong>Skip and report</strong><small>Export every valid selected page.</small></span></label>
      </fieldset>
    </aside>
  );
}
