import { describe, expect, it } from "vitest";
import {
  closeGroupTab,
  createWorkspaceGroups,
  moveGroupTab,
  navigateGroupHistory,
  openGroupTab,
  reconcileWorkspaceGroups,
  renameGroupTab,
  tabPathForDirection,
  tabPathForShortcut
} from "./workspaceGroups";

describe("workspace groups", () => {
  it("keeps independent ordered tabs and active pages", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "left", "two.fractal.html");
    state = openGroupTab(state, "left", "three.fractal.html");
    state = moveGroupTab(state, "left", "right", "two.fractal.html");
    state = openGroupTab(state, "right", "four.fractal.html");

    expect(state.left.tabs).toEqual(["one.fractal.html", "three.fractal.html"]);
    expect(state.left.activePath).toBe("three.fractal.html");
    expect(state.right?.tabs).toEqual(["two.fractal.html", "four.fractal.html"]);
    expect(state.right?.activePath).toBe("four.fractal.html");
    expect(state.activeGroupId).toBe("right");
  });

  it("copies the only left tab when a drag creates the right group", () => {
    const state = moveGroupTab(createWorkspaceGroups("one.fractal.html"), "left", "right", "one.fractal.html");
    expect(state.left.tabs).toEqual(["one.fractal.html"]);
    expect(state.right?.tabs).toEqual(["one.fractal.html"]);
  });

  it("selects the nearest tab when the active tab closes", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "left", "two.fractal.html");
    state = openGroupTab(state, "left", "three.fractal.html");
    state = closeGroupTab(state, "left", "two.fractal.html");
    expect(state.left.activePath).toBe("three.fractal.html");
  });

  it("collapses an empty group and promotes right when left closes", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "right", "two.fractal.html");
    state = closeGroupTab(state, "left", "one.fractal.html");
    expect(state.right).toBeNull();
    expect(state.left.tabs).toEqual(["two.fractal.html"]);
    expect(state.left.activePath).toBe("two.fractal.html");
  });

  it("maintains history per group", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "left", "two.fractal.html");
    state = openGroupTab(state, "right", "three.fractal.html");
    state = openGroupTab(state, "right", "four.fractal.html");
    state = navigateGroupHistory(state, "right", -1);
    expect(state.right?.activePath).toBe("three.fractal.html");
    expect(state.left.activePath).toBe("two.fractal.html");
  });

  it("renames and removes paths in both groups", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "right", "two.fractal.html");
    state = renameGroupTab(state, "two.fractal.html", "folder/two.fractal.html");
    state = reconcileWorkspaceGroups(state, new Set(["folder/two.fractal.html"]));
    expect(state.left.tabs).toEqual(["folder/two.fractal.html"]);
    expect(state.right).toBeNull();
  });

  it("resolves numbered tabs within one editor group", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "left", "two.fractal.html");
    state = openGroupTab(state, "right", "other.fractal.html");
    expect(tabPathForShortcut(state.left, "2")).toBe("two.fractal.html");
    expect(tabPathForShortcut(state.right!, "1")).toBe("other.fractal.html");
    expect(tabPathForShortcut(state.right!, "2")).toBeNull();
  });

  it("cycles tabs forward and backward with wrapping", () => {
    let state = createWorkspaceGroups("one.fractal.html");
    state = openGroupTab(state, "left", "two.fractal.html");
    state = openGroupTab(state, "left", "three.fractal.html");

    expect(tabPathForDirection(state.left, 1)).toBe("one.fractal.html");
    expect(tabPathForDirection(state.left, -1)).toBe("two.fractal.html");
    expect(tabPathForDirection(createWorkspaceGroups("only.fractal.html").left, 1)).toBeNull();
  });
});
