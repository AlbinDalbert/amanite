import { describe, expect, it } from "vitest";
import { buildTreeCrumbs } from "./TreeLocation";

describe("tree location breadcrumbs", () => {
  it("shows the project, two folders, and compact page name", () => {
    expect(buildTreeCrumbs("My project", "stories/characters/bob.fractal.html", "page")).toEqual([
      { current: false, kind: "project", label: "My project", path: "" },
      { current: false, kind: "folder", label: "stories", path: "stories" },
      { current: false, kind: "folder", label: "characters", path: "stories/characters" },
      { current: true, kind: "page", label: "bob.F" }
    ]);
  });

  it("collapses older folders while preserving the visible destinations", () => {
    expect(buildTreeCrumbs("My project", "archive/world/stories/characters/bob.fractal.html", "page")).toEqual([
      { current: false, kind: "project", label: "My project", path: "" },
      { current: false, kind: "ellipsis", label: ".." },
      { current: false, kind: "folder", label: "stories", path: "archive/world/stories" },
      { current: false, kind: "folder", label: "characters", path: "archive/world/stories/characters" },
      { current: true, kind: "page", label: "bob.F" }
    ]);
  });

  it("marks the current folder and project root", () => {
    expect(buildTreeCrumbs("My project", "stories/characters", "folder").at(-1)).toEqual({
      current: true,
      kind: "folder",
      label: "characters",
      path: "stories/characters"
    });
    expect(buildTreeCrumbs("My project", "", "folder")).toEqual([
      { current: true, kind: "project", label: "My project", path: "" }
    ]);
  });
});
