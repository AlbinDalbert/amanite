import type { ExternalLinkRewrite } from "./documentRuntime";

export type LinkRewriteComparison =
  | Readonly<{ kind: "unchanged" }>
  | Readonly<{ kind: "safe"; rewrites: readonly ExternalLinkRewrite[] }>
  | Readonly<{ kind: "unsafe"; reason: string }>;

function normalizeWithoutHref(bodyHtml: string) {
  const parsed = new DOMParser().parseFromString(bodyHtml || "<p></p>", "text/html");
  const body = parsed.body.cloneNode(true) as HTMLElement;
  const links = [...body.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "");
  const normalize = (element: Element) => {
    if (element.matches("a")) element.removeAttribute("href");
    [...element.children].forEach((child) => normalize(child));
    // Lexical may wrap plain imported text in an attribute-free span. It is
    // not a user-authored structural change, so compare its semantic markup.
    if (element.matches("span") && !element.attributes.length) {
      const parent = element.parentNode;
      if (!parent) return;
      while (element.firstChild) parent.insertBefore(element.firstChild, element);
      parent.removeChild(element);
    }
  };
  [...body.children].forEach((element) => normalize(element));
  body.querySelectorAll("p").forEach((paragraph) => {
    if (paragraph.childElementCount === 1 && paragraph.firstElementChild?.matches("br") && !paragraph.textContent) paragraph.replaceChildren();
  });
  if (!body.textContent?.trim() && !body.querySelector("a, img, table, hr, iframe, video, audio")) return { links, markup: "<p></p>" };
  return { links, markup: body.innerHTML };
}

/**
 * A title move is allowed to update an open editor in place only when Fractal
 * changed href values and nothing else in the editable body. This keeps the
 * source-replacement decision explicit for any markup we cannot prove safe.
 */
export function compareEditableLinkRewrites(beforeBodyHtml: string, afterBodyHtml: string): LinkRewriteComparison {
  if (beforeBodyHtml === afterBodyHtml) return { kind: "unchanged" };

  const before = normalizeWithoutHref(beforeBodyHtml);
  const after = normalizeWithoutHref(afterBodyHtml);
  if (before.markup !== after.markup || before.links.length !== after.links.length) {
    return {
      kind: "unsafe",
      reason: "The title move changed more than link targets in an open document. Reload it or explicitly replace the local source."
    };
  }

  const rewrites = before.links
    .map((from, index) => ({ from, to: after.links[index] }))
    .filter(({ from, to }) => from !== to);
  return rewrites.length ? { kind: "safe", rewrites } : { kind: "unchanged" };
}
