import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { FractalBacklink, FractalIframe, FractalIframeBacklink, FractalLink, FractalPageKind } from "@/lib/fractal/types";
import InspectorPanel from "./InspectorPanel";
import { readEditablePage, writeEditableBody, writeEditableTitle } from "./pageSource";
import RawHtmlEditor from "./RawHtmlEditor";
import RenderedHtmlPage from "./RenderedHtmlPage";
import RichDocumentEditor from "./RichDocumentEditor";

type FractalEditorProps = {
  backlinks: FractalBacklink[];
  isBusy: boolean;
  iframeBacklinks: FractalIframeBacklink[];
  iframes: FractalIframe[];
  kind: FractalPageKind;
  links: FractalLink[];
  pagePath: string;
  source: string;
  onChangeSource: (source: string) => void;
  onNavigatePage: (pagePath: string) => void;
  onSave: () => void;
};

function FractalEditor({ backlinks, isBusy, iframeBacklinks, iframes, kind, links, pagePath, source, onChangeSource, onNavigatePage, onSave }: FractalEditorProps) {
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSourceMode, setIsSourceMode] = useState(false);
  const page = useMemo(() => readEditablePage(source), [source]);

  useEffect(() => {
    setIsInspectorOpen(false);
    setIsSourceMode(false);
  }, [pagePath]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className={isInspectorOpen ? "fractal-editor inspector-open" : "fractal-editor"} onKeyDown={handleKeyDown}>
      {kind === "native" ? (
        <RichDocumentEditor
          bodyHtml={page.bodyHtml}
          isBusy={isBusy}
          pagePath={pagePath}
          title={page.title}
          onChangeBody={(bodyHtml) =>
            onChangeSource(writeEditableBody(source, bodyHtml, page.hasTitleHeading))
          }
          onChangeTitle={(title) =>
            onChangeSource(writeEditableTitle(source, title, page.hasTitleHeading))
          }
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      ) : isSourceMode ? (
        <RawHtmlEditor
          isBusy={isBusy}
          pagePath={pagePath}
          source={source}
          onChangeSource={onChangeSource}
          onPreview={() => setIsSourceMode(false)}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      ) : (
        <RenderedHtmlPage
          links={links}
          pagePath={pagePath}
          source={source}
          onEditSource={() => setIsSourceMode(true)}
          onNavigatePage={onNavigatePage}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      )}
      <InspectorPanel backlinks={backlinks} iframeBacklinks={iframeBacklinks} iframes={iframes} links={links} onNavigatePage={onNavigatePage} />
    </div>
  );
}

export default FractalEditor;
