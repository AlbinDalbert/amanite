import { $generateNodesFromDOM } from "@lexical/html";
import {
  $createParagraphNode,
  $getRoot,
  type LexicalEditor as LexicalEditorInstance
} from "lexical";

export const AMANITE_HTML_LOAD_TAG = "amanite-html-load";

const FRACTAL_ALLOWED_BODY_ELEMENTS = new Set([
  "a",
  "blockquote",
  "code",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "ul"
]);

function unwrapElement(element: Element) {
  const parent = element.parentNode;

  if (!parent) {
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
}

export function sanitizeFractalBodyHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";

  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();

    if (!FRACTAL_ALLOWED_BODY_ELEMENTS.has(tagName)) {
      unwrapElement(element);
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      if (tagName === "a" && ["data-fractal-link", "href"].includes(attribute.name)) {
        continue;
      }

      element.removeAttribute(attribute.name);
    }
  }

  return template.innerHTML || "<p></p>";
}

export function importHtmlIntoEditor(editor: LexicalEditorInstance, html: string) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(sanitizeFractalBodyHtml(html), "text/html");
  const nodes = $generateNodesFromDOM(editor, dom.body);
  const root = $getRoot();

  root.clear();

  if (nodes.length > 0) {
    root.append(...nodes);
  }

  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}
