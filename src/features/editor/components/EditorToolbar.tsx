import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, $isListNode } from "@lexical/list";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode, $getSelection, $insertNodes, $isRangeSelection, FORMAT_TEXT_COMMAND, type TextFormatType } from "lexical";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { useCallback, useEffect, useState } from "react";
import { $createIframeNode, $createImageNode } from "./MediaNodes";

type ButtonProps = { active?: boolean; disabled: boolean; label: string; title: string; onClick: () => void };
function ToolButton({ active = false, disabled, label, title, onClick }: ButtonProps) {
  return <button aria-pressed={active} className="rich-toolbar-button" disabled={disabled} onClick={onClick} title={title} type="button">{label}</button>;
}

function EditorToolbar({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [formats, setFormats] = useState<Record<TextFormatType, boolean>>({} as Record<TextFormatType, boolean>);
  const [blockType, setBlockType] = useState("paragraph");

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
  const link = () => {
    const href = window.prompt("Link address");
    if (href?.trim()) editor.dispatchCommand(TOGGLE_LINK_COMMAND, href.trim());
  };
  const image = () => {
    const src = window.prompt("Image source");
    if (!src?.trim()) return;
    const alt = window.prompt("Alternative text") ?? "";
    editor.update(() => $insertNodes([$createImageNode(src.trim(), alt)]));
  };
  const iframe = () => {
    const src = window.prompt("Iframe source");
    if (!src?.trim()) return;
    const title = window.prompt("Iframe title") ?? "";
    editor.update(() => $insertNodes([$createIframeNode(src.trim(), title, "") ]));
  };

  return (
    <div className={isMoreOpen ? "rich-toolbar-stack more-open" : "rich-toolbar-stack"} aria-label="Text formatting">
      <div className="rich-toolbar" role="toolbar">
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
          <ToolButton disabled={disabled} label="Link" title="Add link" onClick={link} />
          <ToolButton disabled={disabled} label="Unlink" title="Remove link" onClick={() => editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)} />
          <ToolButton disabled={disabled} label="Image" title="Add image" onClick={image} />
          <ToolButton disabled={disabled} label="Iframe" title="Add iframe" onClick={iframe} />
          <ToolButton disabled={disabled} label="Table" title="Add 3 by 3 table" onClick={() => editor.dispatchCommand(INSERT_TABLE_COMMAND, { columns: "3", rows: "3", includeHeaders: true })} />
          <ToolButton disabled={disabled} label="Rule" title="Horizontal rule" onClick={() => editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)} />
        </div>
      </div> : null}
    </div>
  );
}

export default EditorToolbar;
