import { useEffect, useMemo, useRef, type FormEvent } from "react";

export type DocumentCounts = {
  characters: number;
  paragraphs: number;
  readingMinutes: number;
  words: number;
};

function documentText(source: string, native: boolean) {
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = native ? document.body.querySelector("main[data-fractal-document]") : document.body;
  if (!root) return "";
  const mirroredTitle = native && root.querySelector(":scope > h1")?.textContent?.trim() === document.title.trim()
    ? root.querySelector(":scope > h1")
    : null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.parentElement?.closest("script, style") && !mirroredTitle?.contains(node)) parts.push(node.textContent ?? "");
  }
  return parts.join(" ").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

export function countDocument(source: string, native: boolean): DocumentCounts {
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = native ? document.body.querySelector("main[data-fractal-document]") : document.body;
  const text = documentText(source, native);
  const words = text ? text.split(/\s+/u).length : 0;
  return {
    characters: text.length,
    paragraphs: root?.querySelectorAll("p, li, blockquote, pre").length ?? 0,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 225)),
    words
  };
}

export function countTextMatches(source: string, query: string, native: boolean) {
  if (!query) return 0;
  const text = documentText(source, native).toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += Math.max(needle.length, 1);
  }
  return count;
}

export function replaceDocumentText(source: string, query: string, replacement: string, native: boolean) {
  if (!query) return source;
  const document = new DOMParser().parseFromString(source, "text/html");
  const root = native ? document.body.querySelector("main[data-fractal-document]") : document.body;
  if (!root) return source;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style, a")) continue;
    node.textContent = node.textContent?.replace(pattern, replacement) ?? "";
  }
  const doctype = document.doctype ? `<!doctype ${document.doctype.name}>\n` : "<!doctype html>\n";
  return `${doctype}${document.documentElement.outerHTML}\n`;
}

type FindBarProps = {
  currentMatch: number;
  isOpen: boolean;
  matchCount: number;
  query: string;
  replacement: string;
  onChangeQuery: (query: string) => void;
  onChangeReplacement: (replacement: string) => void;
  onClose: () => void;
  onNext: (direction: 1 | -1) => void;
  onReplaceAll: () => void;
};

export function FindBar(props: FindBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.isOpen) requestAnimationFrame(() => inputRef.current?.select());
  }, [props.isOpen]);
  if (!props.isOpen) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onNext(1);
  }

  return (
    <form className="document-find-bar" onSubmit={submit} role="search">
      <label>
        <span>Find</span>
        <input aria-label="Find text" onChange={(event) => props.onChangeQuery(event.currentTarget.value)} ref={inputRef} value={props.query} />
      </label>
      <span className="find-count">{props.matchCount ? `${props.currentMatch + 1} / ${props.matchCount}` : "No matches"}</span>
      <button disabled={!props.matchCount} onClick={() => props.onNext(-1)} title="Previous match" type="button">↑</button>
      <button disabled={!props.matchCount} onClick={() => props.onNext(1)} title="Next match" type="button">↓</button>
      <label className="find-replace-field">
        <span>Replace</span>
        <input aria-label="Replacement text" onChange={(event) => props.onChangeReplacement(event.currentTarget.value)} value={props.replacement} />
      </label>
      <button disabled={!props.matchCount} onClick={props.onReplaceAll} type="button">Replace all</button>
      <button aria-label="Close find" onClick={props.onClose} type="button">×</button>
    </form>
  );
}

export function DocumentStatusBar({ counts, focusMode, wordGoal, onFind, onPrint, onToggleFocus }: {
  counts: DocumentCounts;
  focusMode: boolean;
  wordGoal: number;
  onFind: () => void;
  onPrint: () => void;
  onToggleFocus: () => void;
}) {
  const summary = useMemo(() => [
    `${counts.words.toLocaleString()} words`,
    ...(wordGoal ? [`${Math.min(100, Math.round(counts.words / wordGoal * 100))}% of ${wordGoal.toLocaleString()}`] : []),
    `${counts.characters.toLocaleString()} characters`,
    `${counts.paragraphs.toLocaleString()} blocks`,
    counts.readingMinutes ? `${counts.readingMinutes} min read` : "Empty page"
  ], [counts, wordGoal]);
  return (
    <footer className="document-status-bar">
      <div>{summary.map((item) => <span key={item}>{item}</span>)}</div>
      <div>
        <button onClick={onFind} type="button">Find</button>
        <button onClick={onPrint} type="button">Print</button>
        <button aria-pressed={focusMode} onClick={onToggleFocus} type="button">{focusMode ? "Exit focus" : "Focus"}</button>
      </div>
    </footer>
  );
}
