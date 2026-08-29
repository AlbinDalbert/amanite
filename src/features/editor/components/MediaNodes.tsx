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

export const SAFE_IFRAME_SANDBOX = "allow-same-origin";

type MediaAttributes = Record<string, string>;
type SerializedImageNode = Spread<{
  altText: string;
  attributes?: MediaAttributes;
  src: string;
  type: "image";
  version: 1;
}, SerializedLexicalNode>;
type SerializedIframeNode = Spread<{
  attributes?: MediaAttributes;
  sandboxValue: string;
  src: string;
  titleText: string;
  type: "iframe";
  version: 1;
}, SerializedLexicalNode>;

function readAttributes(element: Element): MediaAttributes {
  return Object.fromEntries(Array.from(element.attributes, ({ name, value }) => [name, value]));
}

function writeAttributes(element: Element, attributes: MediaAttributes) {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}

function imageAttributes(src: string, altText: string, attributes: MediaAttributes = {}) {
  return { ...attributes, src, alt: altText };
}

function iframeAttributes(src: string, titleText: string, sandboxValue: string, attributes: MediaAttributes = {}) {
  const next: MediaAttributes = { ...attributes, src };
  if (titleText) next.title = titleText;
  if (sandboxValue) next.sandbox = sandboxValue;
  return next;
}

export class ImageNode extends DecoratorNode<JSX.Element> {
  __attributes: MediaAttributes;

  static getType() { return "image"; }
  static clone(node: ImageNode) { return new ImageNode(node.__attributes, node.__key); }
  static importJSON(node: SerializedImageNode) {
    return new ImageNode(node.attributes ?? imageAttributes(node.src, node.altText));
  }
  static importDOM(): DOMConversionMap {
    return { img: () => ({ conversion: (element) => ({ node: new ImageNode(readAttributes(element)) }), priority: 1 }) };
  }

  constructor(attributes: MediaAttributes, key?: NodeKey) {
    super(key);
    this.__attributes = attributes;
  }

  createDOM(config: EditorConfig) {
    const span = document.createElement("span");
    span.className = config.theme.image as string ?? "rich-image";
    return span;
  }
  updateDOM() { return false; }
  decorate() {
    return <img
      alt={this.__attributes.alt ?? ""}
      className="rich-image"
      decoding="async"
      height={this.__attributes.height || undefined}
      loading="lazy"
      src={this.__attributes.src ?? ""}
      title={this.__attributes.title || undefined}
      width={this.__attributes.width || undefined}
    />;
  }
  exportDOM(): DOMExportOutput {
    const image = document.createElement("img");
    writeAttributes(image, this.__attributes);
    return { element: image };
  }
  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      altText: this.__attributes.alt ?? "",
      attributes: this.__attributes,
      src: this.__attributes.src ?? "",
      type: "image",
      version: 1
    };
  }
  isInline() { return false; }
}

export class IframeNode extends DecoratorNode<JSX.Element> {
  __attributes: MediaAttributes;

  static getType() { return "iframe"; }
  static clone(node: IframeNode) { return new IframeNode(node.__attributes, node.__key); }
  static importJSON(node: SerializedIframeNode) {
    return new IframeNode(node.attributes ?? iframeAttributes(node.src, node.titleText, node.sandboxValue));
  }
  static importDOM(): DOMConversionMap {
    return { iframe: () => ({ conversion: (element) => ({ node: new IframeNode(readAttributes(element)) }), priority: 1 }) };
  }

  constructor(attributes: MediaAttributes, key?: NodeKey) {
    super(key);
    this.__attributes = attributes;
  }

  createDOM() {
    const span = document.createElement("span");
    span.className = "rich-iframe-node";
    return span;
  }
  updateDOM() { return false; }
  decorate() {
    return <iframe
      className="rich-iframe"
      height={this.__attributes.height || undefined}
      loading={this.__attributes.loading === "lazy" ? "lazy" : undefined}
      referrerPolicy={this.__attributes.referrerpolicy as React.HTMLAttributeReferrerPolicy | undefined}
      sandbox={SAFE_IFRAME_SANDBOX}
      src={this.__attributes.src || undefined}
      srcDoc={this.__attributes.srcdoc || undefined}
      title={this.__attributes.title || "Embedded page"}
      width={this.__attributes.width || undefined}
    />;
  }
  exportDOM(): DOMExportOutput {
    const frame = document.createElement("iframe");
    writeAttributes(frame, this.__attributes);
    frame.setAttribute("sandbox", SAFE_IFRAME_SANDBOX);
    return { element: frame };
  }
  exportJSON(): SerializedIframeNode {
    return {
      ...super.exportJSON(),
      attributes: this.__attributes,
      sandboxValue: SAFE_IFRAME_SANDBOX,
      src: this.__attributes.src ?? "",
      titleText: this.__attributes.title ?? "",
      type: "iframe",
      version: 1
    };
  }
  isInline() { return false; }
}

export function $createImageNode(src: string, altText = "", attributes?: MediaAttributes): ImageNode {
  return $applyNodeReplacement(new ImageNode(imageAttributes(src, altText, attributes)));
}

export function $createIframeNode(src: string, title = "", sandboxValue = "", attributes?: MediaAttributes): IframeNode {
  return $applyNodeReplacement(new IframeNode(iframeAttributes(src, title, sandboxValue, attributes)));
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode { return node instanceof ImageNode; }
export function $isIframeNode(node: LexicalNode | null | undefined): node is IframeNode { return node instanceof IframeNode; }
