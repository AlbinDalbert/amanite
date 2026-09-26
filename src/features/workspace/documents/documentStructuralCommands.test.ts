import { describe, expect, it } from "vitest";
import { compareEditableLinkRewrites } from "./documentStructuralCommands";

describe("document structural commands", () => {
  it("accepts href-only rewrites even when Lexical adds plain text spans", () => {
    expect(compareEditableLinkRewrites(
      '<p><a href="old.fractal.html"><span>Target</span></a></p>',
      '<p><a href="new.fractal.html">Target</a></p>'
    )).toEqual({ kind: "safe", rewrites: [{ from: "old.fractal.html", to: "new.fractal.html" }] });
  });

  it("rejects a title receipt that changed document markup beyond hrefs", () => {
    expect(compareEditableLinkRewrites(
      '<p><a href="old.fractal.html">Target</a></p>',
      '<p><strong><a href="new.fractal.html">Target</a></strong></p>'
    )).toMatchObject({ kind: "unsafe" });
  });

  it("reports a body with no link changes as unchanged", () => {
    expect(compareEditableLinkRewrites("<p>Same</p>", "<p>Same</p>")).toEqual({ kind: "unchanged" });
  });

  it("treats Lexical's empty paragraph and Fractal's whitespace-only body as the same", () => {
    expect(compareEditableLinkRewrites("<p><br></p>", "\n    \n")).toEqual({ kind: "unchanged" });
  });
});
