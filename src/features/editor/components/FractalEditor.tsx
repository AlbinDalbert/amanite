import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type {
  FractalBacklink,
  FractalLink,
  FractalNativeSection,
  FractalPage
} from "@/lib/fractal/types";
import { countTextMatches, DocumentStatusBar, FindBar, replaceDocumentText } from "./DocumentTools";
import InspectorPanel from "./InspectorPanel";
import { analyzeEditablePage, readEditablePage, writeEditableBody, writeEditableTitle } from "./pageSource";
import RichDocumentEditor, { resolveEditorLinkTarget } from "./RichDocumentEditor";
import { safeExternalHref } from "./linkNavigation";
import ExportDialog from "./ExportDialog";
import type { FractalHtmlExportReport } from "@/lib/fractal/types";

type FractalEditorProps = {
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  backlinks: FractalBacklink[];
  focusMode: boolean;
  isBusy: boolean;
  isFractalValid: boolean;
  links: FractalLink[];
  pages: FractalPage[];
  pagePath: string;
  projectName: string;
  source: string;
  spellCheck: boolean;
  wordGoal: number;
  onChangeSource: (source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onExport: (includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport | null>;
  onNavigatePage: (pagePath: string) => void;
  onOpenFolder: (folderPath: string) => void;
  onRepair: () => void;
  onSave: () => void;
  onToggleFocus: () => void;
  onToggleBorealis: () => void;
};

function findInElement(root: Element | null, query: string, matchIndex: number) {
  if (!root || !query) return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const needle = query.toLocaleLowerCase();
  let seen = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style")) continue;
    const text = node.textContent ?? "";
    let offset = 0;
    while ((offset = text.toLocaleLowerCase().indexOf(needle, offset)) >= 0) {
      if (seen++ === matchIndex) {
        const range = root.ownerDocument.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + query.length);
        const selection = root.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        node.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      offset += Math.max(query.length, 1);
    }
  }
}

function FractalEditor(props: FractalEditorProps) {
  const { backlinks, borealisOpen, borealisWorkspace, focusMode, isBusy, isFractalValid, links, pages, pagePath, projectName, source, spellCheck, wordGoal, onChangeSource, onExport, onNavigatePage, onOpenFolder, onRepair, onSave, onToggleBorealis, onToggleFocus } = props;
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [inspectorWidth, setInspectorWidth] = useState(292);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const nativeAnalysis = useMemo(() => analyzeEditablePage(source), [source]);
  const page = nativeAnalysis.page;
  const counts = nativeAnalysis.counts;
  const matchCount = useMemo(() => countTextMatches(source, findQuery, true), [findQuery, source]);
  const outline = nativeAnalysis.outline;

  useEffect(() => {
    setIsInspectorOpen(false);
    setIsFindOpen(false);
    setFindQuery("");
    setCurrentMatch(0);
  }, [pagePath]);
  useEffect(() => setCurrentMatch((current) => matchCount ? Math.min(current, matchCount - 1) : 0), [matchCount]);

  function showMatch(index: number) {
    if (!matchCount || !findQuery) return;
    const next = (index + matchCount) % matchCount;
    setCurrentMatch(next);
    findInElement(editorRootRef.current?.querySelector(".rich-content-editable") ?? null, findQuery, next);
  }

  function replaceAll() {
    if (!findQuery) return;
    const next = replaceDocumentText(source, findQuery, replacement, true);
    onChangeSource(next, { section: "content", value: readEditablePage(next).bodyHtml });
    setCurrentMatch(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    const derivedLink = target instanceof Element ? target.closest<HTMLElement>("[data-amanite-derived-target]") : null;
    if (event.key === "Enter" && derivedLink?.dataset.amaniteDerivedTarget) {
      event.preventDefault();
      onNavigatePage(derivedLink.dataset.amaniteDerivedTarget);
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    if (key === "s") { event.preventDefault(); onSave(); }
    else if (key === "f" || key === "h") { event.preventDefault(); setIsFindOpen(true); }
    else if (key === "l" && event.shiftKey) { event.preventDefault(); setIsInspectorOpen((open) => !open); }
    else if (key === "\\") { event.preventDefault(); onToggleFocus(); }
  }

  function jumpToHeading(index: number) {
    editorRootRef.current?.querySelectorAll(".rich-content-editable h1, .rich-content-editable h2, .rich-content-editable h3, .rich-content-editable h4, .rich-content-editable h5, .rich-content-editable h6")[index]
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function startInspectorResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const editor = editorRootRef.current;
    if (!editor) return;
    const move = (pointerEvent: globalThis.PointerEvent) => {
      const bounds = editor.getBoundingClientRect();
      setInspectorWidth(Math.round(Math.min(420, Math.max(230, bounds.right - pointerEvent.clientX))));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("resizing-panel"); };
    document.body.classList.add("resizing-panel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function handleEditorLinkClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target;
    const derivedLink = target instanceof Element ? target.closest<HTMLElement>("[data-amanite-derived-target]") : null;
    const derivedTarget = derivedLink?.dataset.amaniteDerivedTarget;
    if (derivedTarget) {
      event.preventDefault();
      event.stopPropagation();
      onNavigatePage(derivedTarget);
      return;
    }
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const href = anchor.getAttribute("href") ?? "";
    const pageTarget = resolveEditorLinkTarget(href, links, pagePath, pages);
    if (pageTarget) {
      onNavigatePage(pageTarget);
      return;
    }
    const link = links.find((candidate) => candidate.href === href);
    const externalHref = link?.target.kind === "external" ? safeExternalHref(link.target.value) : null;
    if (externalHref) window.open(externalHref, "_blank", "noopener,noreferrer");
  }

  const protection = !isFractalValid
    ? { title: "This Fractal document is invalid", copy: "Amanite opened the page without changing it. Rich editing stays disabled until Fractal can read its native sections.", issues: [] }
    : nativeAnalysis.inspection.compatibilityIssues.length
      ? { title: "This document needs protection", copy: "The page uses markup the rich editor cannot preserve. Amanite has left the file untouched and disabled rich editing.", issues: nativeAnalysis.inspection.compatibilityIssues.map((issue) => `Rich editing cannot preserve ${issue}.`) }
      : null;

  return (
    <div className={isInspectorOpen ? "fractal-editor inspector-open" : "fractal-editor"} onClickCapture={handleEditorLinkClick} onKeyDown={handleKeyDown} ref={editorRootRef} style={{ "--inspector-width": `${inspectorWidth}px` } as CSSProperties}>
      <div className="fractal-editor-main">
        {protection ? (
          <section className="native-document-guard" aria-labelledby="native-document-guard-title">
            <div>
              <span>Document protected</span>
              <h2 id="native-document-guard-title">{protection.title}</h2>
              <p>{protection.copy}</p>
              {protection.issues.length ? <ul>{protection.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
              <small>{pagePath}</small>
              {!isFractalValid ? <button className="primary-action" disabled={isBusy} onClick={onRepair} type="button">Repair document structure</button> : null}
              <details><summary>View exact source</summary><pre>{source}</pre></details>
            </div>
          </section>
        ) : (
          <RichDocumentEditor
            bodyHtml={page.bodyHtml}
            isBusy={isBusy}
            pagePath={pagePath}
            pages={pages}
            projectName={projectName}
            spellCheck={spellCheck}
            title={page.title}
            onChangeBody={(bodyHtml) => onChangeSource(writeEditableBody(source, bodyHtml, page.hasTitleHeading), { section: "content", value: bodyHtml })}
            onChangeTitle={(title) => onChangeSource(writeEditableTitle(source, title, page.hasTitleHeading), { section: "title", value: title })}
            onOpenFolder={onOpenFolder}
            onToggleInspector={() => setIsInspectorOpen((open) => !open)}
          />
        )}
        <FindBar
          currentMatch={currentMatch}
          isOpen={isFindOpen}
          matchCount={matchCount}
          query={findQuery}
          replacement={replacement}
          onChangeQuery={(query) => { setFindQuery(query); setCurrentMatch(0); }}
          onChangeReplacement={setReplacement}
          onClose={() => setIsFindOpen(false)}
          onNext={(direction) => showMatch(currentMatch + direction)}
          onReplaceAll={replaceAll}
        />
        <DocumentStatusBar borealisOpen={borealisOpen} borealisWorkspace={borealisWorkspace} counts={counts} focusMode={focusMode} wordGoal={wordGoal} onExport={() => setIsExportOpen(true)} onFind={() => setIsFindOpen(true)} onToggleBorealis={onToggleBorealis} onToggleFocus={onToggleFocus} />
      </div>
      <InspectorPanel
        backlinks={backlinks}
        links={links}
        outline={outline}
        onNavigateHeading={jumpToHeading}
        onNavigatePage={onNavigatePage}
        onResizeReset={() => setInspectorWidth(292)}
        onResizeStart={startInspectorResize}
      />
      {isExportOpen ? <ExportDialog pagePath={pagePath} onClose={() => setIsExportOpen(false)} onExport={onExport} /> : null}
    </div>
  );
}

export default FractalEditor;
