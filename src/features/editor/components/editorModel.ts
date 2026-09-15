import type { EditorState, LexicalNode } from "lexical";
import { $getNodeByKey, $getRoot, $isElementNode } from "lexical";
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

type BlockModel = {
  countedBlocks: number;
  nodeKeys: Set<string>;
  outline: Omit<EditorOutlineItem, "index">[];
  text: string;
  words: number;
};

function readBlock(node: LexicalNode): BlockModel {
  const textParts: string[] = [];
  const countedBlocks = { value: 0 };
  const outline: EditorOutlineItem[] = [];
  const nodeKeys = new Set<string>();
  const track = (current: LexicalNode) => {
    nodeKeys.add(current.getKey());
    if ($isElementNode(current)) for (const child of current.getChildren()) track(child);
  };
  track(node);
  visit(node, textParts, countedBlocks, outline);
  const text = normalizeText(textParts);
  return { countedBlocks: countedBlocks.value, nodeKeys, outline: outline.map(({ label, level }) => ({ label, level })), text, words: text ? text.split(/\s+/u).length : 0 };
}

export class DerivedEditorModel {
  private blocks = new Map<string, BlockModel>();
  private characters = 0;
  private nodeToBlock = new Map<string, string>();
  private nonemptyBlocks = 0;
  private order: string[] = [];
  private paragraphs = 0;
  private textCache: { revision: number; value: string } | null = null;
  private words = 0;

  update(editorState: EditorState, revision: number, dirtyElements?: ReadonlyMap<string, boolean>, dirtyLeaves?: ReadonlySet<string>) {
    editorState.read(() => {
      const root = $getRoot();
      const rebuildAll = !this.order.length || dirtyElements?.has("root");
      const affected = new Set<string>();
      if (rebuildAll) {
        for (const key of this.blocks.keys()) affected.add(key);
        this.order = root.getChildren().map((node) => node.getKey());
        for (const key of this.order) affected.add(key);
      } else {
        for (const key of [...(dirtyElements?.keys() ?? []), ...(dirtyLeaves?.keys() ?? [])]) {
          let node = $getNodeByKey(key);
          while (node?.getParent() && node.getParent()?.getKey() !== "root") node = node.getParent();
          const blockKey = node?.getKey() ?? this.nodeToBlock.get(key);
          if (blockKey) affected.add(blockKey);
        }
      }

      for (const key of affected) {
        const previous = this.blocks.get(key);
        if (previous) {
          this.characters -= previous.text.length;
          this.nonemptyBlocks -= Number(Boolean(previous.text));
          this.paragraphs -= previous.countedBlocks;
          this.words -= previous.words;
          for (const nodeKey of previous.nodeKeys) this.nodeToBlock.delete(nodeKey);
        }
        const node = $getNodeByKey(key);
        if (!node || node.getParent()?.getKey() !== "root") {
          this.blocks.delete(key);
          this.order = this.order.filter((candidate) => candidate !== key);
          continue;
        }
        const next = readBlock(node);
        this.blocks.set(key, next);
        this.characters += next.text.length;
        this.nonemptyBlocks += Number(Boolean(next.text));
        this.paragraphs += next.countedBlocks;
        this.words += next.words;
        for (const nodeKey of next.nodeKeys) this.nodeToBlock.set(nodeKey, key);
      }
    });
    this.textCache = null;
    const service = this;
    return {
      counts: {
        characters: this.characters + Math.max(0, this.nonemptyBlocks - 1),
        paragraphs: this.paragraphs,
        readingMinutes: this.words === 0 ? 0 : Math.max(1, Math.ceil(this.words / 225)),
        words: this.words
      },
      get outline() {
        return service.order.flatMap((key) => service.blocks.get(key)?.outline ?? []).map((item, index) => ({ ...item, index }));
      },
      revision,
      get text() { return service.text(revision); }
    } satisfies EditorModelSnapshot;
  }

  private text(revision: number) {
    if (this.textCache?.revision === revision) return this.textCache.value;
    const value = normalizeText(this.order.map((key) => this.blocks.get(key)?.text ?? ""));
    this.textCache = { revision, value };
    return value;
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
