import type { FractalPage } from "./types";

export type PageTitleTarget = { path: string; title: string };

function pageTitle(page: FractalPage, overrides: Map<string, string>) {
  return overrides.get(page.path) ?? page.title?.trim() ?? "";
}

function titleKey(title: string) {
  return title.toLocaleLowerCase();
}

export class PageTitleIndex {
  private pagesByPath = new Map<string, FractalPage>();
  private pageOrder: string[] = [];
  private titleOverrides = new Map<string, string>();
  private uniqueTargetsCache = new Map<string, { version: number; targets: PageTitleTarget[] }>();
  private titleGroups = new Map<string, PageTitleTarget[]>();
  private _version = 0;
  private _rebuildCount = 0;

  constructor(pages: FractalPage[] = []) {
    this.update(pages);
  }

  get version() {
    return this._version;
  }

  get rebuildCount() {
    return this._rebuildCount;
  }

  update(pages: FractalPage[]) {
    const nextPages = new Map(pages.map((page) => [page.path, page]));
    let identityChanged = nextPages.size !== this.pagesByPath.size;
    if (!identityChanged) {
      for (const [path, page] of nextPages) {
        const previous = this.pagesByPath.get(path);
        if (!previous || (previous.title?.trim() ?? "") !== (page.title?.trim() ?? "")) {
          identityChanged = true;
          break;
        }
      }
    }

    this.pagesByPath = nextPages;
    this.pageOrder = pages.map((page) => page.path);
    for (const path of this.titleOverrides.keys()) if (!nextPages.has(path)) this.titleOverrides.delete(path);
    if (identityChanged) this.rebuildTitles();
    return identityChanged;
  }

  setLiveTitle(path: string, title: string) {
    const catalogTitle = this.pagesByPath.get(path)?.title?.trim() ?? "";
    const nextTitle = title.trim();
    const previousTitle = this.titleOverrides.get(path) ?? catalogTitle;
    if (nextTitle === catalogTitle) this.titleOverrides.delete(path);
    else this.titleOverrides.set(path, nextTitle);
    if (previousTitle === nextTitle) return false;
    this.rebuildTitles();
    return true;
  }

  getPage(path: string) {
    return this.pagesByPath.get(path) ?? null;
  }

  getTitle(path: string) {
    const page = this.pagesByPath.get(path);
    return page ? pageTitle(page, this.titleOverrides) : null;
  }

  pages() {
    return this.pageOrder.map((path) => this.pagesByPath.get(path)).filter((page): page is FractalPage => Boolean(page));
  }

  uniqueTargets(excludedPath: string) {
    const cached = this.uniqueTargetsCache.get(excludedPath);
    if (cached?.version === this._version) return cached.targets;
    const targets = Array.from(this.titleGroups.values())
      .filter((group) => group.length === 1 && group[0].path !== excludedPath)
      .map((group) => group[0])
      .sort((left, right) => Array.from(right.title).length - Array.from(left.title).length || left.path.localeCompare(right.path));
    this.uniqueTargetsCache.set(excludedPath, { version: this._version, targets });
    return targets;
  }

  matchingPages(query: string, excludedPath: string, limit = 8) {
    const needle = query.trim().toLocaleLowerCase();
    return this.pages()
      .filter((page) => page.path !== excludedPath)
      .map((page) => {
        const title = pageTitle(page, this.titleOverrides)
          || page.path.split("/").at(-1)?.replace(/\.fractal\.html$/i, "")
          || page.path;
        const titleLower = title.toLocaleLowerCase();
        const pathLower = page.path.toLocaleLowerCase();
        const rank = !needle ? 0 : titleLower.startsWith(needle) ? 0 : titleLower.includes(needle) ? 1 : pathLower.includes(needle) ? 2 : -1;
        return { page: title === page.title ? page : { ...page, title }, rank, title };
      })
      .filter((result) => result.rank >= 0)
      .sort((left, right) => left.rank - right.rank || left.title.localeCompare(right.title) || left.page.path.localeCompare(right.page.path))
      .slice(0, limit);
  }

  private rebuildTitles() {
    this.titleGroups = new Map();
    for (const path of this.pageOrder) {
      const page = this.pagesByPath.get(path);
      const title = page ? pageTitle(page, this.titleOverrides) : "";
      if (!title) continue;
      const key = titleKey(title);
      this.titleGroups.set(key, [...(this.titleGroups.get(key) ?? []), { path, title }]);
    }
    this._version += 1;
    this._rebuildCount += 1;
    this.uniqueTargetsCache.clear();
  }
}
