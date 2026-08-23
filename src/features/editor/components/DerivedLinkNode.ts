import {
  $applyNodeReplacement,
  TextNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread
} from "lexical";
type SerializedDerivedLinkNode = Spread<{
  pagePath: string;
  target: string;
  type: "derived-link";
  version: 1;
}, SerializedTextNode>;

export class DerivedLinkNode extends TextNode {
  __pagePath: string;
  __target: string;

  static getType() { return "derived-link"; }
  static clone(node: DerivedLinkNode) { return new DerivedLinkNode(node.__text, node.__target, node.__pagePath, node.__key); }
  static importJSON(node: SerializedDerivedLinkNode) {
    return $createDerivedLinkNode(node.text, node.target, node.pagePath)
      .setDetail(node.detail)
      .setFormat(node.format)
      .setMode(node.mode)
      .setStyle(node.style);
  }

  constructor(text: string, target: string, pagePath: string, key?: NodeKey) {
    super(text, key);
    this.__target = target;
    this.__pagePath = pagePath;
  }

  getTarget() { return this.getLatest().__target; }

  createDOM(config: EditorConfig, editor?: LexicalEditor) {
    const linkBehavior = document.createElement("span");
    linkBehavior.className = "rich-derived-link";
    linkBehavior.dataset.amaniteDerivedTarget = this.__target;
    linkBehavior.role = "link";
    linkBehavior.tabIndex = 0;
    linkBehavior.title = `Open ${this.__target}`;
    linkBehavior.appendChild(super.createDOM(config, editor));
    return linkBehavior;
  }

  updateDOM(previous: this, dom: HTMLElement, config: EditorConfig) {
    if (previous.__target !== this.__target || previous.__pagePath !== this.__pagePath) return true;
    const textElement = dom.firstElementChild;
    return !(textElement instanceof HTMLElement) || super.updateDOM(previous, textElement, config);
  }

  exportDOM(editor: LexicalEditor): DOMExportOutput {
    return super.exportDOM(editor);
  }

  exportJSON(): SerializedDerivedLinkNode {
    return { ...super.exportJSON(), pagePath: this.__pagePath, target: this.__target, type: "derived-link", version: 1 };
  }

  canInsertTextBefore() { return false; }
  canInsertTextAfter() { return false; }
}

export function $createDerivedLinkNode(text: string, target: string, pagePath: string) {
  return $applyNodeReplacement(new DerivedLinkNode(text, target, pagePath));
}

export function $isDerivedLinkNode(node: LexicalNode | null | undefined): node is DerivedLinkNode {
  return node instanceof DerivedLinkNode;
}
