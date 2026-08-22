export type EditablePage = {
  bodyHtml: string;
  hasTitleHeading: boolean;
  title: string;
};

const NATIVE_ROOT_SELECTOR = "main[data-fractal-document]";

export function readEditablePage(source: string): EditablePage {
  const document = new DOMParser().parseFromString(source, "text/html");
  const documentRoot = document.body.querySelector(NATIVE_ROOT_SELECTOR);
  const titleHeading = documentRoot?.querySelector("h1");
  const hasTitleHeading = titleHeading?.textContent?.trim() === document.title.trim();
  if (hasTitleHeading) titleHeading.remove();

  return {
    bodyHtml: documentRoot?.innerHTML || "<p></p>",
    hasTitleHeading,
    title: document.title
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
