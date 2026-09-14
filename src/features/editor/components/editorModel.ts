import type { EditorState, LexicalNode } from "lexical";
import { $getRoot, $isElementNode } from "lexical";
import type { DocumentCounts } from "./DocumentTools";

export type EditorOutlineItem = { index: number; label: string; level: number };

export type EditorModelSnapshot = {
  counts: DocumentCounts;
  outline: EditorOutlineItem[];
  revision: number;
  text: string;
};

const TEXT_BLOCK_TYPES = new Set(["paragraph", "listitem", "quote", "code", "heading", "tablecell"]);
const COUNTED_BLOCK_TYPES = new Set(["paragraph", "listitem", "quote", "code"]);

function normalizeText(parts: string[]) {
  return parts.join(" ").replace(/\s+/gu, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
}

function visit(node: LexicalNode, textParts: string[], countedBlocks: { value: number }, outline: EditorOutlineItem[]) {
  const type = node.getType();
  if (TEXT_BLOCK_TYPES.has(type)) textParts.push(node.getTextContent());
  if (COUNTED_BLOCK_TYPES.has(type)) countedBlocks.value += 1;
  if (type === "heading" && "getTag" in node && typeof node.getTag === "function") {
    const tag = node.getTag();
    outline.push({ index: outline.length, label: node.getTextContent().trim() || "Untitled heading", level: Number(tag.slice(1)) });
  }
  if ($isElementNode(node) && !TEXT_BLOCK_TYPES.has(type)) {
    for (const child of node.getChildren()) visit(child, textParts, countedBlocks, outline);
  }
}

export function readEditorModel(editorState: EditorState, revision: number): EditorModelSnapshot {
  return editorState.read(() => {
    const textParts: string[] = [];
    const countedBlocks = { value: 0 };
    const outline: EditorOutlineItem[] = [];
    for (const child of $getRoot().getChildren()) visit(child, textParts, countedBlocks, outline);
    const text = normalizeText(textParts);
    const words = text ? text.split(/\s+/u).length : 0;
    return {
      counts: {
        characters: text.length,
        paragraphs: countedBlocks.value,
        readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 225)),
        words
      },
      outline,
      revision,
      text
    };
  });
}

export function countTextMatchesInText(text: string, query: string) {
  if (!query) return 0;
  const needle = query.toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += Math.max(needle.length, 1);
  }
  return count;
}

