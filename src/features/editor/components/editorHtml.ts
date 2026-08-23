import { $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";

export const AMANITE_HTML_LOAD_TAG = "amanite-html-load";

const ALLOWED_ELEMENTS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "cite", "code", "col", "colgroup", "del", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "iframe", "img", "ins",
  "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strong", "sub", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var"
]);

function allowedAttributes(tag: string) {
  return tag === "a" ? ["href", "title"]
    : tag === "img" || tag === "iframe" ? null
    : tag === "time" ? ["datetime"]
    : tag === "td" || tag === "th" ? ["colspan", "rowspan"]
    : tag === "col" || tag === "colgroup" ? ["span"]
    : [];
}

export function richEditorCompatibilityIssues(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const issues: string[] = [];
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) issues.push(`<${tag}>`);
    for (const attribute of Array.from(element.attributes)) {
      const allowed = allowedAttributes(tag);
      if (allowed && !allowed.includes(attribute.name)) issues.push(`<${tag}> ${attribute.name}`);
    }
  }
  return [...new Set(issues)];
}

function unwrap(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

export function cleanEditorHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) {
      unwrap(element);
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const allowed = allowedAttributes(tag);
      if (allowed && !allowed.includes(attribute.name)) element.removeAttribute(attribute.name);
    }
  }
  return template.innerHTML || "<p></p>";
}

export function importHtmlIntoEditor(editor: LexicalEditor, html: string) {
  const document = new DOMParser().parseFromString(cleanEditorHtml(html), "text/html");
  const nodes = $generateNodesFromDOM(editor, document.body);
  const root = $getRoot();
  root.clear();
  if (nodes.length) root.append(...nodes);
  if (!root.getChildrenSize()) root.append($createParagraphNode());
}
