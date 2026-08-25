import { richEditorCompatibilityIssues } from "./editorHtml";

export type EditablePage = {
  bodyHtml: string;
  hasTitleHeading: boolean;
  title: string;
};

export type EditablePageInspection = {
  compatibilityIssues: string[];
  structuralIssues: string[];
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

export function inspectEditablePage(source: string): EditablePageInspection {
  const document = new DOMParser().parseFromString(source, "text/html");
  const roots = Array.from(document.body.querySelectorAll(NATIVE_ROOT_SELECTOR));
  const structuralIssues: string[] = [];

  if (document.doctype?.name.toLowerCase() !== "html") structuralIssues.push("The HTML doctype is missing.");
  if (!document.head.querySelector('meta[name="fractal-format" i][content="1"]')) structuralIssues.push("The Fractal format marker is missing.");
  if (roots.length !== 1) structuralIssues.push("The document needs exactly one Fractal document root.");

  const outsideElements = Array.from(document.body.children)
    .filter((element) => !element.matches(NATIVE_ROOT_SELECTOR))
    .map((element) => `<${element.tagName.toLowerCase()}>`);
  if (outsideElements.length) structuralIssues.push(`Elements outside the document root: ${outsideElements.join(", ")}.`);

  const root = roots[0];
  const compatibilityIssues = root ? richEditorCompatibilityIssues(root.innerHTML) : [];
  const unsupportedElements = compatibilityIssues.filter((issue) => !issue.includes(" "));
  if (unsupportedElements.length) structuralIssues.push(`Unsupported Fractal elements: ${unsupportedElements.join(", ")}.`);

  const allowedHeadElements = new Set(["link", "meta", "style", "title"]);
  const unsupportedHead = Array.from(document.head.querySelectorAll("*"))
    .map((element) => element.tagName.toLowerCase())
    .filter((tag) => !allowedHeadElements.has(tag));
  if (unsupportedHead.length) structuralIssues.push(`Unsupported head elements: ${[...new Set(unsupportedHead)].map((tag) => `<${tag}>`).join(", ")}.`);

  return {
    compatibilityIssues: compatibilityIssues.filter((issue) => !unsupportedElements.includes(issue)),
    structuralIssues
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
