import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread
} from "lexical";
import type { JSX } from "react";

type SerializedImageNode = Spread<{ altText: string; src: string; type: "image"; version: 1 }, SerializedLexicalNode>;
type SerializedIframeNode = Spread<{ sandboxValue: string; src: string; titleText: string; type: "iframe"; version: 1 }, SerializedLexicalNode>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;

  static getType() { return "image"; }
  static clone(node: ImageNode) { return new ImageNode(node.__src, node.__altText, node.__key); }
  static importJSON(node: SerializedImageNode) { return $createImageNode(node.src, node.altText); }
  static importDOM(): DOMConversionMap { return { img: () => ({ conversion: (element) => ({ node: $createImageNode(element.getAttribute("src") ?? "", element.getAttribute("alt") ?? "") }), priority: 1 }) }; }

  constructor(src: string, altText: string, key?: NodeKey) { super(key); this.__src = src; this.__altText = altText; }
  createDOM(config: EditorConfig) { const span = document.createElement("span"); span.className = config.theme.image as string ?? "rich-image"; return span; }
  updateDOM() { return false; }
  decorate() { return <img alt={this.__altText} className="rich-image" src={this.__src} />; }
  exportDOM(): DOMExportOutput { const image = document.createElement("img"); image.src = this.__src; image.alt = this.__altText; return { element: image }; }
  exportJSON(): SerializedImageNode { return { ...super.exportJSON(), altText: this.__altText, src: this.__src, type: "image", version: 1 }; }
  isInline() { return false; }
}

export class IframeNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __titleText: string;
  __sandboxValue: string;

  static getType() { return "iframe"; }
  static clone(node: IframeNode) { return new IframeNode(node.__src, node.__titleText, node.__sandboxValue, node.__key); }
  static importJSON(node: SerializedIframeNode) { return $createIframeNode(node.src, node.titleText, node.sandboxValue); }
  static importDOM(): DOMConversionMap { return { iframe: () => ({ conversion: (element) => ({ node: $createIframeNode(element.getAttribute("src") ?? "", element.getAttribute("title") ?? "", element.getAttribute("sandbox") ?? "") }), priority: 1 }) }; }

  constructor(src: string, titleText: string, sandboxValue: string, key?: NodeKey) { super(key); this.__src = src; this.__titleText = titleText; this.__sandboxValue = sandboxValue; }
  createDOM() { const span = document.createElement("span"); span.className = "rich-iframe-node"; return span; }
  updateDOM() { return false; }
  decorate() { return <iframe className="rich-iframe" sandbox={this.__sandboxValue || undefined} src={this.__src} title={this.__titleText || "Embedded page"} />; }
  exportDOM(): DOMExportOutput { const frame = document.createElement("iframe"); frame.src = this.__src; if (this.__titleText) frame.title = this.__titleText; if (this.__sandboxValue) frame.setAttribute("sandbox", this.__sandboxValue); return { element: frame }; }
  exportJSON(): SerializedIframeNode { return { ...super.exportJSON(), sandboxValue: this.__sandboxValue, src: this.__src, titleText: this.__titleText, type: "iframe", version: 1 }; }
  isInline() { return false; }
}

export function $createImageNode(src: string, altText = ""): ImageNode { return $applyNodeReplacement(new ImageNode(src, altText)); }
export function $createIframeNode(src: string, title = "", sandboxValue = ""): IframeNode { return $applyNodeReplacement(new IframeNode(src, title, sandboxValue)); }
export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode { return node instanceof ImageNode; }
export function $isIframeNode(node: LexicalNode | null | undefined): node is IframeNode { return node instanceof IframeNode; }
