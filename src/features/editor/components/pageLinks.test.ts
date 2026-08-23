import { describe, expect, it } from "vitest";
import type { FractalPage } from "@/lib/fractal/types";
import { findDerivedPageLinks, matchingPages, relativePageHref } from "./pageLinks";

const pages = [
  { path: "index.fractal.html", title: "Index" },
  { path: "people/ada.fractal.html", title: "Ada Lovelace" },
  { path: "places/stockholm.fractal.html", title: "Stockholm" },
  { path: "places/stockholm-city.fractal.html", title: "Stockholm City" }
] as FractalPage[];

describe("inline page links", () => {
  it("derives live exact-title links and prefers the longest title", () => {
    expect(findDerivedPageLinks("Stockholm City and Stockholm.", "index.fractal.html", pages)).toEqual([
      { start: 0, end: 14, target: "places/stockholm-city.fractal.html", title: "Stockholm City" },
      { start: 19, end: 28, target: "places/stockholm.fractal.html", title: "Stockholm" }
    ]);
  });

  it("uses JavaScript offsets for text containing surrogate pairs", () => {
    expect(findDerivedPageLinks("😀 ADA LOVELACE", "index.fractal.html", pages)).toEqual([
      { start: 3, end: 15, target: "people/ada.fractal.html", title: "Ada Lovelace" }
    ]);
  });

  it("does not derive partial words, ambiguous titles, current pages, or @ queries", () => {
    const ambiguous = [...pages, { path: "history/ada.fractal.html", title: "Ada Lovelace" }] as FractalPage[];
    expect(findDerivedPageLinks("Index Ada LovelaceX @Stockholm", "index.fractal.html", ambiguous)).toEqual([]);
  });

  it("sorts @ results by title prefix before path matches", () => {
    expect(matchingPages("stock", "index.fractal.html", pages).map(({ page }) => page.path)).toEqual([
      "places/stockholm.fractal.html",
      "places/stockholm-city.fractal.html"
    ]);
  });

  it("builds relative file hrefs", () => {
    expect(relativePageHref("notes/today.fractal.html", "index.fractal.html")).toBe("../index.fractal.html");
    expect(relativePageHref("notes/today.fractal.html", "notes/other.fractal.html")).toBe("./other.fractal.html");
    expect(relativePageHref("index.fractal.html", "notes/other.fractal.html")).toBe("./notes/other.fractal.html");
  });
});
