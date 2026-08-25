import DOMPurify from "dompurify";
import { marked } from "marked";

const allowedTags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul"
];

const allowedAttributes = ["class", "href", "title"];

export function renderMarkdown(content: string) {
  const html = marked.parse(content, { async: false, breaks: true, gfm: true });
  return DOMPurify.sanitize(html, {
    ALLOWED_ATTR: allowedAttributes,
    ALLOWED_TAGS: allowedTags,
    FORBID_ATTR: ["style"]
  });
}

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="ai-chat-message-content ai-chat-markdown"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
