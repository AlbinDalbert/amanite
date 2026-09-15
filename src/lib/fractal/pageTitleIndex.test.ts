import { describe, expect, it } from "vitest";
import type { FractalPage } from "./types";
import { PageTitleIndex } from "./pageTitleIndex";

function page(path: string, title: string, _text = "saved text"): FractalPage {
  return { contentHash: `${path}:hash`, path, title };
}

describe("PageTitleIndex", () => {
  it("does not rebuild title groups for body-only catalog changes", () => {
    const index = new PageTitleIndex([page("one.fractal.html", "One")]);
    const rebuilds = index.rebuildCount;

    expect(index.update([page("one.fractal.html", "One", "new body")])).toBe(false);
    expect(index.rebuildCount).toBe(rebuilds);
    expect(index.uniqueTargets("")).toEqual([{ path: "one.fractal.html", title: "One" }]);
  });

  it("rebuilds unique targets when titles or live title overrides change", () => {
    const index = new PageTitleIndex([
      page("one.fractal.html", "One"),
      page("two.fractal.html", "Two")
    ]);
    expect(index.uniqueTargets("one.fractal.html")).toEqual([{ path: "two.fractal.html", title: "Two" }]);

    const rebuilds = index.rebuildCount;
    expect(index.setLiveTitle("two.fractal.html", "Renamed")).toBe(true);
    expect(index.rebuildCount).toBe(rebuilds + 1);
    expect(index.uniqueTargets("one.fractal.html")).toEqual([{ path: "two.fractal.html", title: "Renamed" }]);
    expect(index.matchingPages("ren", "one.fractal.html")[0]?.title).toBe("Renamed");
  });

  it("keeps duplicate titles out of derived-link targets", () => {
    const index = new PageTitleIndex([
      page("one.fractal.html", "Same"),
      page("two.fractal.html", "Same"),
      page("three.fractal.html", "Different")
    ]);

    expect(index.uniqueTargets("one.fractal.html")).toEqual([{ path: "three.fractal.html", title: "Different" }]);
  });
});
