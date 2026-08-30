import { describe, expect, it } from "vitest";
import type { FractalLink, FractalPage } from "@/lib/fractal/types";
import { displayPagePath, resolveEditorLinkTarget } from "./RichDocumentEditor";

const pages = [
  { path: "index.fractal.html" },
  { path: "notes/today.fractal.html" }
] as FractalPage[];

describe("rich editor link navigation", () => {
  it("shows native page paths with the compact .F suffix", () => {
    expect(displayPagePath("characters/vivian.fractal.html")).toBe("characters/vivian.F");
    expect(displayPagePath("notes/reference.html")).toBe("notes/reference.html");
  });

  it("uses Fractal's resolved internal target", () => {
    const links = [{ href: "../index.fractal.html", text: "Index", target: { kind: "internal", value: "index.fractal.html" } }] as FractalLink[];
    expect(resolveEditorLinkTarget("../index.fractal.html", links, "notes/today.fractal.html", pages)).toBe("index.fractal.html");
  });

  it("recognizes Lexical's display URL for a bare relative href", () => {
    const links = [{ href: "index.fractal.html", text: "Index", target: { kind: "internal", value: "index.fractal.html" } }] as FractalLink[];
    expect(resolveEditorLinkTarget("https://index.fractal.html", links, "notes.fractal.html", pages)).toBe("index.fractal.html");
  });

  it("resolves a relative page link when metadata is temporarily stale", () => {
    expect(resolveEditorLinkTarget("today.fractal.html", [], "notes/other.fractal.html", pages)).toBe("notes/today.fractal.html");
  });

  it("does not turn external links into workspace navigation", () => {
    expect(resolveEditorLinkTarget("https://example.com", [], "index.fractal.html", pages)).toBeNull();
  });
});
