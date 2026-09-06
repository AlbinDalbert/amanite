import type { DocumentCounts } from "./DocumentTools";
import { richEditorCompatibilityIssuesForRoot } from "./editorHtml";

export type EditablePage = {
  bodyHtml: string;
  hasTitleHeading: boolean;
  title: string;
};

export type EditablePageInspection = {
  compatibilityIssues: string[];
};

export type EditablePageAnalysis = {
  counts: DocumentCounts;
  inspection: EditablePageInspection;
  outline: Array<{ index: number; label: string; level: number }>;
  page: EditablePage;
};

const NATIVE_ROOT_SELECTOR = "main[data-fractal-document]";

export function readEditablePage(source: string): EditablePage {
  const document = new DOMParser().parseFromString(source, "text/html");
  const documentRoot = document.body.querySelector(NATIVE_ROOT_SELECTOR);
  const titleHeading = documentRoot?.querySelector("h1");
  const titleElement = document.head.querySelector("title");
  const title = titleElement?.textContent?.trim() || titleHeading?.textContent?.trim() || "";
  const hasTitleHeading = Boolean(titleHeading && (!titleElement || titleHeading.textContent?.trim() === titleElement.textContent?.trim()));
  if (hasTitleHeading) titleHeading?.remove();

  return {
    bodyHtml: documentRoot?.innerHTML || "<p></p>",
    hasTitleHeading,
    title
  };
}

export function analyzeEditablePage(source: string): EditablePageAnalysis {
  const document = new DOMParser().parseFromString(source, "text/html");
  const roots = Array.from(document.body.querySelectorAll(NATIVE_ROOT_SELECTOR));
  const documentRoot = roots[0];
  const titleHeading = documentRoot?.querySelector(":scope > h1");
  const titleElement = document.head.querySelector("title");
  const title = titleElement?.textContent?.trim() || titleHeading?.textContent?.trim() || "";
  const hasTitleHeading = Boolean(titleHeading && (!titleElement || titleHeading.textContent?.trim() === titleElement.textContent?.trim()));
  const compatibilityIssues = documentRoot ? richEditorCompatibilityIssuesForRoot(documentRoot) : [];

  const outline = documentRoot ? Array.from(documentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .filter((heading) => !hasTitleHeading || heading !== titleHeading)
    .map((heading, index) => ({
      index,
      label: heading.textContent?.trim() || "Untitled heading",
      level: Number(heading.tagName.slice(1))
    })) : [];

  const textParts: string[] = [];
  if (documentRoot) {
    const walker = document.createTreeWalker(documentRoot, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest("script, style") && (!hasTitleHeading || !titleHeading?.contains(node))) {
        textParts.push(node.textContent ?? "");
      }
    }
  }
  const text = textParts.join(" ").replace(/\s+/g, " ").replace(/\s+([.,!?;:])/g, "$1").trim();
  const words = text ? text.split(/\s+/u).length : 0;

  if (hasTitleHeading) titleHeading?.remove();
  return {
    counts: {
      characters: text.length,
      paragraphs: documentRoot?.querySelectorAll("p, li, blockquote, pre").length ?? 0,
      readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 225)),
      words
    },
    inspection: {
      compatibilityIssues
    },
    outline,
    page: {
      bodyHtml: documentRoot?.innerHTML || "<p></p>",
      hasTitleHeading,
      title
    }
  };
}

function serializeDocument(document: Document) {
  const doctype = document.doctype
    ? `<!doctype ${document.doctype.name}>\n`
    : "<!doctype html>\n";
  return `${doctype}${document.documentElement.outerHTML}\n`;
}

export function writeEditableBody(source: string, bodyHtml: string, hasTitleHeading: boolean) {
  const document = new DOMParser().parseFromString(source, "text/html");
  const documentRoot = document.body.querySelector(NATIVE_ROOT_SELECTOR);
  if (!documentRoot) throw new Error("Native document root is missing.");
  documentRoot.innerHTML = bodyHtml;
  if (hasTitleHeading) {
    const heading = document.createElement("h1");
    heading.setAttribute("data-fractal-title", "");
    heading.textContent = document.title;
    documentRoot.prepend(heading);
  }
  return serializeDocument(document);
}

export function writeEditableTitle(source: string, title: string, hasTitleHeading: boolean) {
  const document = new DOMParser().parseFromString(source, "text/html");
  let titleElement = document.head.querySelector("title");
  if (!titleElement) {
    titleElement = document.createElement("title");
    document.head.append(titleElement);
  }
  titleElement.textContent = title;
  if (hasTitleHeading) {
    const heading = document.body.querySelector(`${NATIVE_ROOT_SELECTOR} h1`);
    if (heading) heading.textContent = title;
  }
  return serializeDocument(document);
}
