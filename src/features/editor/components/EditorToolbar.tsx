import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, $isListNode } from "@lexical/list";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $deleteTableColumnAtSelection, $deleteTableRowAtSelection, $insertTableColumnAtSelection, $insertTableRowAtSelection, INSERT_TABLE_COMMAND } from "@lexical/table";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode, $getSelection, $insertNodes, $isRangeSelection, $isTextNode, FORMAT_ELEMENT_COMMAND, FORMAT_TEXT_COMMAND, INDENT_CONTENT_COMMAND, OUTDENT_CONTENT_COMMAND, REDO_COMMAND, UNDO_COMMAND, type TextFormatType } from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { useCallback, useEffect, useState } from "react";
import { $createIframeNode, $createImageNode } from "./MediaNodes";
import type { FractalPage } from "@/lib/fractal/types";
import { relativePageHref } from "./pageLinks";

type ButtonProps = { active?: boolean; disabled: boolean; label: string; title: string; onClick: () => void };
function ToolButton({ active = false, disabled, label, title, onClick }: ButtonProps) {
  return <button aria-pressed={active} className="rich-toolbar-button" disabled={disabled} onClick={onClick} title={title} type="button">{label}</button>;
}

function EditorToolbar({ disabled, pagePath, pages }: { disabled: boolean; pagePath: string; pages: FractalPage[] }) {
  const [editor] = useLexicalComposerContext();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [formats, setFormats] = useState<Record<TextFormatType, boolean>>({} as Record<TextFormatType, boolean>);
  const [blockType, setBlockType] = useState("paragraph");
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [isIframeOpen, setIsIframeOpen] = useState(false);
  const [iframeSource, setIframeSource] = useState("");
  const [iframeTitle, setIframeTitle] = useState("");

  const readSelection = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setFormats({
      bold: selection.hasFormat("bold"),
      code: selection.hasFormat("code"),
      highlight: selection.hasFormat("highlight"),
      italic: selection.hasFormat("italic"),
      lowercase: selection.hasFormat("lowercase"),
      strikethrough: selection.hasFormat("strikethrough"),
      subscript: selection.hasFormat("subscript"),
      superscript: selection.hasFormat("superscript"),
      underline: selection.hasFormat("underline"),
      uppercase: selection.hasFormat("uppercase"),
      capitalize: selection.hasFormat("capitalize")
    });
    const anchor = selection.anchor.getNode();
    const block = anchor.getKey() === "root" ? anchor : anchor.getTopLevelElementOrThrow();
    if ($isHeadingNode(block)) setBlockType(block.getTag());
    else if ($isCodeNode(block)) setBlockType("code");
    else if ($isQuoteNode(block)) setBlockType("quote");
    else if ($isListNode(block)) setBlockType(block.getListType());
    else setBlockType("paragraph");
  }, []);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => editorState.read(readSelection)), [editor, readSelection]);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const root = editor.getRootElement();
      if (!root?.contains(document.activeElement)) return;
      event.preventDefault();
      setIsLinkOpen(true);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [editor]);
  const text = (format: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  const block = (kind: "paragraph" | "quote" | HeadingTagType) => editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (kind === "paragraph") $setBlocksType(selection, () => $createParagraphNode());
    else if (kind === "quote") $setBlocksType(selection, () => $createQuoteNode());
    else $setBlocksType(selection, () => $createHeadingNode(kind));
  });
  const codeBlock = () => editor.update(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) $setBlocksType(selection, () => $createCodeNode());
  });
  const applyLink = (href: string) => {
    if (!href.trim()) return;
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, href.trim());
    setIsLinkOpen(false);
    setLinkQuery("");
  };
  const image = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => editor.update(() => $insertNodes([$createImageNode(String(reader.result), file.name.replace(/\.[^.]+$/, ""))]));
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const clearFormatting = () => editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    for (const node of selection.getNodes()) if ($isTextNode(node)) { node.setFormat(0); node.setStyle(""); }
  });
  const filteredPages = pages.filter((page) => page.path !== pagePath && `${page.title ?? ""} ${page.path}`.toLocaleLowerCase().includes(linkQuery.toLocaleLowerCase())).slice(0, 7);
  const iframe = () => {
    setIsIframeOpen(true);
  };
  const applyIframe = () => {
    if (!iframeSource.trim()) return;
    editor.update(() => $insertNodes([$createIframeNode(iframeSource.trim(), iframeTitle.trim(), "") ]));
    setIsIframeOpen(false);
    setIframeSource("");
    setIframeTitle("");
  };

  return (
    <div className={isMoreOpen ? "rich-toolbar-stack more-open" : "rich-toolbar-stack"} aria-label="Text formatting">
      <div className="rich-toolbar" role="toolbar">
        <div className="rich-toolbar-group">
          <ToolButton disabled={disabled} label="↶" title="Undo (Ctrl+Z)" onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)} />
          <ToolButton disabled={disabled} label="↷" title="Redo (Ctrl+Shift+Z)" onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={formats.bold} disabled={disabled} label="B" title="Bold" onClick={() => text("bold")} />
          <ToolButton active={formats.italic} disabled={disabled} label="I" title="Italic" onClick={() => text("italic")} />
          <ToolButton active={formats.underline} disabled={disabled} label="U" title="Underline" onClick={() => text("underline")} />
          <ToolButton active={formats.strikethrough} disabled={disabled} label="S" title="Strikethrough" onClick={() => text("strikethrough")} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={isMoreOpen} disabled={disabled} label={isMoreOpen ? "Less" : "More"} title="More formatting" onClick={() => setIsMoreOpen((open) => !open)} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={blockType === "paragraph"} disabled={disabled} label="Text" title="Paragraph" onClick={() => block("paragraph")} />
          <ToolButton active={blockType === "h1"} disabled={disabled} label="H1" title="Heading 1" onClick={() => block("h1")} />
          <ToolButton active={blockType === "h2"} disabled={disabled} label="H2" title="Heading 2" onClick={() => block("h2")} />
          <ToolButton active={blockType === "quote"} disabled={disabled} label="Quote" title="Quote" onClick={() => block("quote")} />
          <ToolButton active={blockType === "code"} disabled={disabled} label="Code block" title="Code block" onClick={codeBlock} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={blockType === "bullet"} disabled={disabled} label="• List" title="Bulleted list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} />
          <ToolButton active={blockType === "number"} disabled={disabled} label="1. List" title="Numbered list" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} />
        </div>
      </div>
      {isMoreOpen ? <div className="rich-toolbar rich-toolbar-more" role="toolbar" aria-label="More formatting">
        <div className="rich-toolbar-group">
          {(["h3", "h4", "h5", "h6"] as HeadingTagType[]).map((heading) => <ToolButton active={blockType === heading} disabled={disabled} key={heading} label={heading.toUpperCase()} title={`Heading ${heading.slice(1)}`} onClick={() => block(heading)} />)}
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={formats.subscript} disabled={disabled} label="x₂" title="Subscript" onClick={() => text("subscript")} />
          <ToolButton active={formats.superscript} disabled={disabled} label="x²" title="Superscript" onClick={() => text("superscript")} />
          <ToolButton active={formats.code} disabled={disabled} label="Code" title="Inline code" onClick={() => text("code")} />
          <ToolButton active={formats.highlight} disabled={disabled} label="Mark" title="Highlight" onClick={() => text("highlight")} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton active={isLinkOpen} disabled={disabled} label="Link" title="Add link (Ctrl+K)" onClick={() => setIsLinkOpen((open) => !open)} />
          <ToolButton disabled={disabled} label="Unlink" title="Remove link" onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)} />
          <ToolButton disabled={disabled} label="Image" title="Add image" onClick={image} />
          <ToolButton disabled={disabled} label="Iframe" title="Add iframe" onClick={iframe} />
          <ToolButton disabled={disabled} label="Table" title="Add 3 by 3 table" onClick={() => editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: "3", rows: "3", includeHeaders: true })} />
          <ToolButton disabled={disabled} label="Rule" title="Horizontal rule" onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton disabled={disabled} label="+ Row" title="Add table row" onClick={() => editor.update(() => { try { $insertTableRowAtSelection(true); } catch { /* Selection is outside a table. */ } })} />
          <ToolButton disabled={disabled} label="− Row" title="Delete table row" onClick={() => editor.update(() => { try { $deleteTableRowAtSelection(); } catch { /* Selection is outside a table. */ } })} />
          <ToolButton disabled={disabled} label="+ Col" title="Add table column" onClick={() => editor.update(() => { try { $insertTableColumnAtSelection(true); } catch { /* Selection is outside a table. */ } })} />
          <ToolButton disabled={disabled} label="− Col" title="Delete table column" onClick={() => editor.update(() => { try { $deleteTableColumnAtSelection(); } catch { /* Selection is outside a table. */ } })} />
        </div>
        <div className="rich-toolbar-group">
          <ToolButton disabled={disabled} label="←" title="Outdent" onClick={() => editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined)} />
          <ToolButton disabled={disabled} label="→" title="Indent" onClick={() => editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined)} />
          <ToolButton disabled={disabled} label="Left" title="Align left" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "left")} />
          <ToolButton disabled={disabled} label="Center" title="Align center" onClick={() => editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, "center")} />
          <ToolButton disabled={disabled} label="Clear" title="Clear text formatting" onClick={clearFormatting} />
        </div>
      </div> : null}
      {isLinkOpen ? (
        <div className="link-picker" role="dialog" aria-label="Add link">
          <label><span>Page or address</span><input autoFocus onChange={(event) => setLinkQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && linkQuery.trim()) applyLink(linkQuery); if (event.key === "Escape") setIsLinkOpen(false); }} placeholder="Search pages or paste a URL" value={linkQuery} /></label>
          <div className="link-picker-results">
            {filteredPages.map((page) => <button key={page.path} onClick={() => applyLink(relativePageHref(pagePath, page.path))} type="button"><strong>{page.title || page.path}</strong><small>{page.path}</small></button>)}
            {linkQuery.trim() ? <button className="link-address-result" onClick={() => applyLink(linkQuery)} type="button"><strong>Use address</strong><small>{linkQuery}</small></button> : null}
          </div>
        </div>
      ) : null}
      {isIframeOpen ? (
        <form className="link-picker iframe-picker" onSubmit={(event) => { event.preventDefault(); applyIframe(); }} role="dialog" aria-label="Add iframe">
          <label><span>Iframe source</span><input autoFocus onChange={(event) => setIframeSource(event.currentTarget.value)} placeholder="https://example.com/embed" value={iframeSource} /></label>
          <label><span>Accessible title</span><input onChange={(event) => setIframeTitle(event.currentTarget.value)} placeholder="Map of Stockholm" value={iframeTitle} /></label>
          <div className="iframe-picker-actions"><button onClick={() => setIsIframeOpen(false)} type="button">Cancel</button><button disabled={!iframeSource.trim()} type="submit">Insert iframe</button></div>
        </form>
      ) : null}
    </div>
  );
}

export default EditorToolbar;
