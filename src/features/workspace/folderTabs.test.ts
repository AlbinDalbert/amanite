import { describe, expect, it } from "vitest";
import { folderPathFromTabId, folderTabId, isFolderTab, PROJECT_OVERVIEW_TAB_ID } from "./folderTabs";

describe("folder workspace tabs", () => {
  it("round-trips nested and root folder paths", () => {
    expect(folderPathFromTabId(folderTabId("drafts/part one"))).toBe("drafts/part one");
    expect(folderPathFromTabId(folderTabId(""))).toBe("");
    expect(PROJECT_OVERVIEW_TAB_ID).toBe(folderTabId(""));
    expect(isFolderTab(PROJECT_OVERVIEW_TAB_ID)).toBe(true);
    expect(isFolderTab(folderTabId("drafts"))).toBe(true);
    expect(isFolderTab("drafts/page.fractal.html")).toBe(false);
  });
});
