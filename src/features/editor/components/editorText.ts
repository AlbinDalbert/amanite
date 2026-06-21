import type { FractalPage } from "@/lib/fractal/types";

const NOTE_PREVIEW_WORD_LIMIT = 26;
const NOTE_PREVIEW_CHARACTER_LIMIT = 190;
const PAGE_PREVIEW_WORD_LIMIT = 34;
const PAGE_PREVIEW_CHARACTER_LIMIT = 240;

export function tagsFromDraft(value: string) {
  const seenTags = new Set<string>();
  const tags: string[] = [];

  for (const part of value.split(/[,\n]/)) {
    const tag = part.trim();
    const key = tag.toLowerCase();

    if (tag && !seenTags.has(key)) {
      seenTags.add(key);
      tags.push(tag);
    }
  }

  return tags;
}

export function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateText(value: string, wordLimit: number, characterLimit: number) {
  const text = compactText(value);

  if (!text) {
    return "";
  }

  const words = text.split(" ");
  if (words.length > wordLimit) {
    return `${words.slice(0, wordLimit).join(" ")}…`;
  }

  if (text.length > characterLimit) {
    return `${text.slice(0, characterLimit - 1).trim()}…`;
  }

  return text;
}

export function truncateNotePreview(value: string) {
  return (
    truncateText(value, NOTE_PREVIEW_WORD_LIMIT, NOTE_PREVIEW_CHARACTER_LIMIT) ||
    "No note body yet."
  );
}

export function pagePreviewText(page: FractalPage) {
  return (
    truncateText(page.summary ?? "", PAGE_PREVIEW_WORD_LIMIT, PAGE_PREVIEW_CHARACTER_LIMIT) ||
    truncateText(page.bodyPreview ?? "", PAGE_PREVIEW_WORD_LIMIT, PAGE_PREVIEW_CHARACTER_LIMIT) ||
    "No summary yet."
  );
}

export function comparisonKey(value: string) {
  return compactText(value).toLowerCase();
}

export function uniqueInspectorItems<T>(
  items: T[],
  keyForItem: (item: T) => string,
  labelForItem: (item: T) => string
) {
  const seenItems = new Set<string>();
  const uniqueItems: string[] = [];

  for (const item of items) {
    const key = comparisonKey(keyForItem(item));

    if (!key || seenItems.has(key)) {
      continue;
    }

    seenItems.add(key);
    uniqueItems.push(labelForItem(item));
  }

  return uniqueItems;
}
