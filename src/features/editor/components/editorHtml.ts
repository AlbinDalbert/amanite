import { $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $getRoot, type LexicalEditor } from "lexical";

export const AMANITE_HTML_LOAD_TAG = "amanite-html-load";

const ALLOWED_ELEMENTS = new Set([
  "a", "blockquote", "br", "code", "em", "h1", "h2", "h3", "li", "ol", "p", "pre", "s", "strong", "u", "ul"
]);

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
      if (tag !== "a" || attribute.name !== "href") element.removeAttribute(attribute.name);
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
