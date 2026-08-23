import { $createLinkNode, $isLinkNode } from "@lexical/link";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
  type MenuRenderFn
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $getRoot, $isTextNode, TextNode } from "lexical";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { FractalPage } from "@/lib/fractal/types";
import { $createDerivedLinkNode, $isDerivedLinkNode, DerivedLinkNode } from "./DerivedLinkNode";
import { derivedPageLinkTargets, findDerivedPageLinksForTargets, matchingPages, relativePageHref } from "./pageLinks";

type Props = { pagePath: string; pages: FractalPage[] };

class PageLinkOption extends MenuOption {
  page: FractalPage;
  title: string;

  constructor(page: FractalPage, title: string) {
    super(page.path);
    this.page = page;
    this.title = title;
  }
}

function copyTextStyle(source: TextNode, target: TextNode) {
  return target
    .setDetail(source.getDetail())
    .setFormat(source.getFormat())
    .setMode(source.getMode())
    .setStyle(source.getStyle());
}

function hasLinkParent(node: TextNode) {
  let parent = node.getParent();
  while (parent) {
    if ($isLinkNode(parent)) return true;
    parent = parent.getParent();
  }
  return false;
}

function edgeCharacter(node: TextNode, direction: "next" | "previous") {
  const sibling = direction === "previous" ? node.getPreviousSibling() : node.getNextSibling();
  if (!$isTextNode(sibling)) return null;
  const characters = Array.from(sibling.getTextContent());
  return direction === "previous" ? characters.at(-1) ?? null : characters[0] ?? null;
}

function matchesNodeBoundaries(node: TextNode, start: number, end: number) {
  const alphanumeric = /[\p{L}\p{N}]/u;
  const before = start === 0 ? edgeCharacter(node, "previous") : null;
  const after = end === node.getTextContentSize() ? edgeCharacter(node, "next") : null;
  return before !== "@" && !(before && alphanumeric.test(before)) && !(after && alphanumeric.test(after));
}

function DerivedLinksPlugin({ pagePath, pages }: Props) {
  const [editor] = useLexicalComposerContext();
  const targets = useMemo(() => derivedPageLinkTargets(pagePath, pages), [pagePath, pages]);

  const transformText = useCallback((node: TextNode) => {
    if ($isDerivedLinkNode(node)) {
      const match = findDerivedPageLinksForTargets(node.getTextContent(), targets)[0];
      if (!match || match.start !== 0 || match.end !== node.getTextContentSize() || match.target !== node.getTarget() || hasLinkParent(node) || !matchesNodeBoundaries(node, match.start, match.end)) {
        node.replace(copyTextStyle(node, $createTextNode(node.getTextContent())));
      }
      return;
    }
    const previous = node.getPreviousSibling();
    const next = node.getNextSibling();
    if ($isDerivedLinkNode(previous)) previous.markDirty();
    if ($isDerivedLinkNode(next)) next.markDirty();
    if (!node.isSimpleText() || hasLinkParent(node) || node.hasFormat("code")) return;
    const matches = findDerivedPageLinksForTargets(node.getTextContent(), targets)
      .filter((match) => matchesNodeBoundaries(node, match.start, match.end));
    if (!matches.length) return;

    const splitOffsets = [...new Set(matches.flatMap((match) => [match.start, match.end]))]
      .filter((offset) => offset > 0 && offset < node.getTextContentSize());
    const parts = splitOffsets.length ? node.splitText(...splitOffsets) : [node];
    let offset = 0;
    for (const part of parts) {
      const end = offset + part.getTextContentSize();
      const match = matches.find((candidate) => candidate.start === offset && candidate.end === end);
      if (match) part.replace(copyTextStyle(part, $createDerivedLinkNode(part.getTextContent(), match.target, pagePath)));
      offset = end;
    }
  }, [pagePath, targets]);

  useEffect(() => {
    const unregisterText = editor.registerNodeTransform(TextNode, transformText);
    const unregisterDerived = editor.registerNodeTransform(DerivedLinkNode, transformText);
    editor.update(() => {
      for (const node of $getRoot().getAllTextNodes()) node.markDirty();
    });
    return () => { unregisterDerived(); unregisterText(); };
  }, [editor, transformText]);

  return null;
}

function PageLinkTypeaheadPlugin({ pagePath, pages }: Props) {
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch("@", { allowWhitespace: true, maxLength: 80, minLength: 0 });
  const options = useMemo(
    () => matchingPages(query ?? "", pagePath, pages).map(({ page, title }) => new PageLinkOption(page, title)),
    [pagePath, pages, query]
  );

  const renderMenu = useCallback<MenuRenderFn<PageLinkOption>>((anchorRef, menu, matchingString) => {
    if (!anchorRef.current) return null;
    return createPortal(
      <div className="page-link-menu" aria-label="Link to a file">
        <header><span>Link a page</span><small>{matchingString ? `@${matchingString}` : "Type a page name"}</small></header>
        {menu.options.length ? (
          <ul>
            {menu.options.map((option, index) => (
              <li key={option.key}>
                <button
                  aria-selected={menu.selectedIndex === index}
                  className={menu.selectedIndex === index ? "selected" : ""}
                  id={`typeahead-item-${index}`}
                  onClick={() => menu.selectOptionAndCleanUp(option)}
                  onMouseEnter={() => menu.setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  ref={(element) => option.setRefElement(element)}
                  role="option"
                  type="button"
                >
                  <span>{option.title}</span>
                  <small>{option.page.path}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : <p>No matching pages</p>}
        <footer><span>↑↓ choose</span><span>Enter link</span><span>Esc close</span></footer>
      </div>,
      anchorRef.current
    );
  }, []);

  return (
    <LexicalTypeaheadMenuPlugin
      anchorClassName="page-link-menu-anchor"
      menuRenderFn={renderMenu}
      onQueryChange={setQuery}
      onSelectOption={(option, queryNode, closeMenu) => {
        if (!queryNode) return;
        const link = $createLinkNode(relativePageHref(pagePath, option.page.path), { title: `Open ${option.title}` });
        link.append($createTextNode(option.title));
        queryNode.replace(link);
        link.selectEnd();
        closeMenu();
      }}
      options={options}
      triggerFn={trigger}
    />
  );
}

function InlinePageLinksPlugin(props: Props) {
  return <><DerivedLinksPlugin {...props} /><PageLinkTypeaheadPlugin {...props} /></>;
}

export default InlinePageLinksPlugin;
