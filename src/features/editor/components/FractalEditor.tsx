import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type {
  FractalBacklink,
  FractalLink,
  FractalNativeSection,
  FractalPage
} from "@/lib/fractal/types";
import { countTextMatches, DocumentStatusBar, FindBar, replaceDocumentText, replaceEditorText } from "./DocumentTools";
import InspectorPanel from "./InspectorPanel";
import { analyzeEditablePage } from "./pageSource";
import RichDocumentEditor, { resolveEditorLinkTarget } from "./RichDocumentEditor";
import { safeExternalHref } from "./linkNavigation";
import { fractalClient } from "@/lib/fractal/client";
import { startPointerResize } from "@/components/ui/pointerResize";
import ExportDialog from "./ExportDialog";
import type { FractalHtmlExportReport } from "@/lib/fractal/types";
import type { EditorSnapshot } from "./editorFlush";
import { countTextMatchesInText, type EditorModelSnapshot } from "./editorModel";
import type { SharedDocumentEditorSession } from "./sharedDocumentEditor";
import type { DocumentSession } from "@/features/workspace/documents/documentRuntime";
import type { PageTitleIndex } from "@/lib/fractal/pageTitleIndex";

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
  bodyHtml?: string;
  hasTitleHeading?: boolean;
  title?: string;
  documentId?: string;
  sourceIncarnation?: number;
  editable?: boolean;
  documentSession?: DocumentSession;
  sharedSession?: SharedDocumentEditorSession;
  viewId?: string;
  spellCheck: boolean;
  wordGoal: number;
  onChangeSource: (source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onModelChange?: (snapshot: EditorModelSnapshot) => void;
  onRevision: (revision?: number) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  pageTitleIndex?: PageTitleIndex;
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
  const { backlinks, bodyHtml: bufferBodyHtml, borealisOpen, borealisWorkspace, documentId, documentSession, editable = true, focusMode, hasTitleHeading: bufferHasTitleHeading, isBusy, isFractalValid, links, pages, pagePath, pageTitleIndex, projectName, sharedSession, source, sourceIncarnation, spellCheck, title: bufferTitle, viewId, wordGoal, onChangeSource, onExport, onModelChange, onNavigatePage, onOpenFolder, onRepair, onRevision, onSave, onSnapshot, onToggleBorealis, onToggleFocus } = props;
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [liveModel, setLiveModel] = useState<EditorModelSnapshot | null>(null);
  const [inspectorWidth, setInspectorWidth] = useState(292);
  const editorRootRef = useRef<HTMLDivElement>(null);
  // Local snapshots come from the already validated rich editor. Inspect native
  // markup again only when a new disk source is installed.
  const inspectionVersion = sourceIncarnation ?? source;
  const nativeAnalysis = useMemo(() => analyzeEditablePage(source), [documentId, inspectionVersion]);
  const matchCount = useMemo(() => !findQuery ? 0 : liveModel ? countTextMatchesInText(liveModel.text, findQuery) : countTextMatches(source, findQuery, true), [findQuery, liveModel, source]);
  const page = nativeAnalysis.page;
  const displayedBodyHtml = bufferBodyHtml ?? page.bodyHtml;
  const displayedTitle = bufferTitle ?? page.title;
  const hasTitleHeading = bufferHasTitleHeading ?? page.hasTitleHeading;
  const counts = liveModel?.counts ?? nativeAnalysis.counts;
  const outline = liveModel?.outline ?? nativeAnalysis.outline;

  useEffect(() => setLiveModel(null), [documentId, pagePath]);

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
    if (!findQuery || !editable) return;
    const editor = documentSession?.editor ?? sharedSession?.editor;
    if (editor) {
      replaceEditorText(editor, findQuery, replacement);
    } else {
      onChangeSource(replaceDocumentText(source, findQuery, replacement, true));
    }
    setCurrentMatch(0);
  }

  function changeTitle(title: string) {
    const revision = documentSession?.setTitle(title) ?? sharedSession?.nextRevision();
    onRevision(revision);
    onChangeSource(source, { section: "title", value: title });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    const derivedLink = target instanceof Element ? target.closest<HTMLElement>("[data-amanite-derived-target]") : null;
    if (event.key === "Enter" && derivedLink?.dataset.amaniteDerivedTarget) {
      event.preventDefault();
      onNavigatePage(derivedLink.dataset.amaniteDerivedTarget);
      return;
    }
    if (!event.metaKey && !event.ctrlKey) return;
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
    const editor = editorRootRef.current;
    if (!editor) return;
    startPointerResize(event, editor, (pointerEvent, bounds) => {
      setInspectorWidth(Math.round(Math.min(420, Math.max(230, bounds.right - pointerEvent.clientX))));
    });
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
    const externalHref = safeExternalHref(href);
    if (externalHref) void fractalClient.openExternal(externalHref);
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
              bodyHtml={displayedBodyHtml}
              documentId={documentId}
              sourceIncarnation={sourceIncarnation}
              documentSession={documentSession}
              historyOwner={editable}
              isBusy={isBusy || !editable}
              pagePath={pagePath}
              pageTitleIndex={pageTitleIndex}
              pages={pages}
              projectName={projectName}
              sharedSession={sharedSession}
              spellCheck={spellCheck}
              title={displayedTitle}
              viewId={viewId}
              onChangeBody={() => undefined}
              onChangeTitle={changeTitle}
              onModelChange={editable ? (snapshot) => { setLiveModel(snapshot); onModelChange?.(snapshot); } : undefined}
              onRevision={editable ? onRevision : undefined}
              onSnapshot={onSnapshot}
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
