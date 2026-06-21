import type { FractalPage, FractalPageLink } from "@/lib/fractal/types";
import { comparisonKey } from "./editorText";

function hrefMatchesLink(anchorHref: string, linkHref: string) {
  if (anchorHref === linkHref) {
    return true;
  }

  // Lexical normalizes bare relative hrefs like "second.html" into
  // "https://second.html" inside the editable DOM. Fractal stores the
  // project-relative href, so treat that synthetic URL form as equivalent.
  if (anchorHref === `https://${linkHref}` || anchorHref === `http://${linkHref}`) {
    return true;
  }

  try {
    const parsedHref = new URL(anchorHref);
    return `${parsedHref.hostname}${parsedHref.pathname}`.replace(/^\//, "") === linkHref;
  } catch {
    return false;
  }
}

export function linkForAnchor(anchor: HTMLAnchorElement, links: FractalPageLink[]) {
  const href = anchor.getAttribute("href") ?? "";
  const textKey = comparisonKey(anchor.textContent ?? "");
  const candidates = links.filter(
    (link) => hrefMatchesLink(href, link.href) && comparisonKey(link.text) === textKey
  );

  if (candidates.length === 1) {
    return candidates[0];
  }

  const textCandidates = links.filter((link) => comparisonKey(link.text) === textKey);
  if (textCandidates.length === 1) {
    return textCandidates[0];
  }

  return candidates.find((link) => link.targetPage || link.targetNote) ?? null;
}

function normalizePagePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return normalized.startsWith("pages/") ? normalized.slice("pages/".length) : normalized;
}

export function resolvePageHref(currentPagePath: string, href: string) {
  if (!href || href.startsWith("#")) {
    return null;
  }

  let hrefForResolution = href;
  const syntheticRelativeUrl = href.match(/^https?:\/\/([^/?#]+\.html)([?#].*)?$/i);
  if (syntheticRelativeUrl) {
    hrefForResolution = `${syntheticRelativeUrl[1]}${syntheticRelativeUrl[2] ?? ""}`;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null;
  }

  const [hrefPath] = hrefForResolution.split(/[?#]/, 1);
  if (!hrefPath) {
    return null;
  }

  const baseParts = normalizePagePath(currentPagePath).split("/");
  baseParts.pop();
  const parts = hrefPath.startsWith("/") ? [] : baseParts;

  for (const part of normalizePagePath(hrefPath).split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  const resolved = parts.join("/");
  return resolved.endsWith(".html") ? resolved : `${resolved}.html`;
}

export function pageForAnchor(
  anchor: HTMLAnchorElement,
  links: FractalPageLink[],
  pages: FractalPage[],
  currentPagePath: string
) {
  const href = anchor.getAttribute("href") ?? "";
  const targetPage = linkForAnchor(anchor, links)?.targetPage ?? resolvePageHref(currentPagePath, href);

  if (!targetPage) {
    return null;
  }

  return pages.find((page) => page.path === targetPage) ?? null;
}
