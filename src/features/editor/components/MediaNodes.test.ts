import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { IframeNode, ImageNode, SAFE_IFRAME_SANDBOX } from "./MediaNodes";

function roundTrip(html: string) {
  const editor = createEditor({ namespace: "media-round-trip", nodes: [IframeNode, ImageNode], onError: (error) => { throw error; } });
  let output = "";
  editor.update(() => {
    const document = new DOMParser().parseFromString(html, "text/html");
    $getRoot().append(...$generateNodesFromDOM(editor, document));
    output = $generateHtmlFromNodes(editor);
  }, { discrete: true });
  return new DOMParser().parseFromString(output, "text/html").body.firstElementChild;
}

describe("media HTML round trips", () => {
  it("keeps image attributes", () => {
    const image = roundTrip('<img src="field.png" alt="Field" title="Map" width="640" data-origin="scan">');
    expect(image?.getAttribute("src")).toContain("field.png");
    expect(image?.getAttribute("alt")).toBe("Field");
    expect(image?.getAttribute("title")).toBe("Map");
    expect(image?.getAttribute("width")).toBe("640");
    expect(image?.getAttribute("data-origin")).toBe("scan");
  });

  it("keeps iframe attributes but forces Amanite's sandbox", () => {
    const frame = roundTrip('<iframe src="map.html" srcdoc="<p>Map</p>" width="720" data-origin="atlas" sandbox="allow-scripts"></iframe>');
    expect(frame?.getAttribute("src")).toContain("map.html");
    expect(frame?.getAttribute("srcdoc")).toBe("<p>Map</p>");
    expect(frame?.getAttribute("width")).toBe("720");
    expect(frame?.getAttribute("data-origin")).toBe("atlas");
    expect(frame?.getAttribute("sandbox")).toBe(SAFE_IFRAME_SANDBOX);
  });
});
