import type { FractalPage } from "@/lib/fractal/types";

export type DerivedPageLinkMatch = {
  end: number;
  start: number;
  target: string;
  title: string;
};

export type DerivedPageLinkTarget = { path: string; title: string };

const ALPHANUMERIC = /[\p{L}\p{N}]/u;

export function derivedPageLinkTargets(pagePath: string, pages: FractalPage[]) {
  const grouped = new Map<string, DerivedPageLinkTarget[]>();
  for (const page of pages) {
    const title = page.title?.trim();
    if (!title || page.path === pagePath) continue;
    const key = title.toLocaleLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), { path: page.path, title }]);
  }
  return [...grouped.values()]
    .filter((targets) => targets.length === 1)
    .map(([target]) => target)
    .filter((target): target is DerivedPageLinkTarget => Boolean(target))
    .sort((left, right) => Array.from(right.title).length - Array.from(left.title).length || left.path.localeCompare(right.path));
}

export function relativePageHref(from: string, target: string) {
  const fromParts = from.split("/");
  fromParts.pop();
  const targetParts = target.split("/");
  while (fromParts.length && targetParts.length && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }
  const href = [...fromParts.map(() => ".."), ...targetParts].join("/") || target.split("/").at(-1)!;
  return href.startsWith(".") ? href : `./${href}`;
}

export function findDerivedPageLinksForTargets(text: string, targets: DerivedPageLinkTarget[]): DerivedPageLinkMatch[] {
  if (!text) return [];
  const characters = Array.from(text);
  const offsets = [0];
  for (const character of characters) offsets.push(offsets.at(-1)! + character.length);

  const matches: DerivedPageLinkMatch[] = [];
  for (const target of targets) {
    const titleLength = Array.from(target.title).length;
    const titleLower = target.title.toLocaleLowerCase();
    for (let index = 0; index + titleLength <= characters.length; index += 1) {
      const start = offsets[index];
      const end = offsets[index + titleLength];
      if (text.slice(start, end).toLocaleLowerCase() !== titleLower) continue;
      const before = characters[index - 1];
      const after = characters[index + titleLength];
      if (before === "@" || (before && ALPHANUMERIC.test(before)) || (after && ALPHANUMERIC.test(after))) continue;
      matches.push({ end, start, target: target.path, title: target.title });
    }
  }

  matches.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start) || left.target.localeCompare(right.target));
  const accepted: DerivedPageLinkMatch[] = [];
  let claimedUntil = 0;
  for (const match of matches) {
    if (match.start < claimedUntil) continue;
    accepted.push(match);
    claimedUntil = match.end;
  }
  return accepted;
}

export function findDerivedPageLinks(text: string, pagePath: string, pages: FractalPage[]) {
  return findDerivedPageLinksForTargets(text, derivedPageLinkTargets(pagePath, pages));
}

export function matchingPages(query: string, pagePath: string, pages: FractalPage[], limit = 8) {
  const needle = query.trim().toLocaleLowerCase();
  return pages
    .filter((page) => page.path !== pagePath)
    .map((page) => {
      const title = page.title?.trim() || page.path.split("/").at(-1)?.replace(/\.fractal\.html$/i, "") || page.path;
      const titleLower = title.toLocaleLowerCase();
      const pathLower = page.path.toLocaleLowerCase();
      const rank = !needle ? 0 : titleLower.startsWith(needle) ? 0 : titleLower.includes(needle) ? 1 : pathLower.includes(needle) ? 2 : -1;
      return { page, rank, title };
    })
    .filter((result) => result.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.title.localeCompare(right.title) || left.page.path.localeCompare(right.page.path))
    .slice(0, limit);
}
