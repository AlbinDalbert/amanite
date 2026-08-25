import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./MarkdownContent";

describe("chat markdown", () => {
  it("renders common markdown blocks", () => {
    const html = renderMarkdown("# Heading\n\n- **Bold**\n- `inline`\n\n```ts\nconst answer = 42;\n```");

    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain('<code class="language-ts">const answer = 42;');
  });

  it("removes unsafe HTML and link protocols", () => {
    const html = renderMarkdown('<script>alert("no")</script>\n\n[Do not follow](javascript:alert("no"))');

    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});
