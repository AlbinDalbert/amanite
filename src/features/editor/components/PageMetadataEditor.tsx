import type { KeyboardEvent, RefObject } from "react";

type PageMetadataEditorProps = {
  isAddingTag: boolean;
  pagePath: string;
  summary?: string | null;
  tagDraft: string;
  tagInputRef: RefObject<HTMLInputElement | null>;
  tags: string[];
  title: string;
  onChangeSummary: (summary: string) => void;
  onChangeTagDraft: (draft: string) => void;
  onChangeTitle: (title: string) => void;
  onCommitTagDraft: () => void;
  onRemoveTag: (tag: string) => void;
  onStartAddingTag: () => void;
  onTagInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

function PageMetadataEditor({
  isAddingTag,
  pagePath,
  summary,
  tagDraft,
  tagInputRef,
  tags,
  title,
  onChangeSummary,
  onChangeTagDraft,
  onChangeTitle,
  onCommitTagDraft,
  onRemoveTag,
  onStartAddingTag,
  onTagInputKeyDown
}: PageMetadataEditorProps) {
  return (
    <>
      <div className="rich-page-meta">
        <span className="editor-page-path" title={pagePath}>
          {pagePath}
        </span>
      </div>

      <textarea
        aria-label={`Title for ${pagePath}`}
        className="rich-title-input"
        onChange={(event) => onChangeTitle(event.currentTarget.value)}
        placeholder="Untitled"
        rows={1}
        value={title}
      />

      <div className="rich-metadata-editor">
        <textarea
          aria-label={`Summary for ${pagePath}`}
          className="rich-summary-input"
          onChange={(event) => onChangeSummary(event.currentTarget.value)}
          placeholder="Add a short page summary..."
          rows={2}
          value={summary ?? ""}
        />

        <div className="rich-tag-row" aria-label="Page tags">
          {tags.map((tag) => (
            <span className="rich-tag" key={tag}>
              <span>{tag}</span>
              <button
                aria-label={`Remove ${tag} tag`}
                className="rich-tag-remove"
                onClick={() => onRemoveTag(tag)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}

          {isAddingTag ? (
            <input
              aria-label="New tag"
              className="rich-tag rich-tag-input"
              onBlur={onCommitTagDraft}
              onChange={(event) => onChangeTagDraft(event.currentTarget.value)}
              onKeyDown={onTagInputKeyDown}
              placeholder="tag"
              ref={tagInputRef}
              value={tagDraft}
            />
          ) : (
            <button
              aria-label="Add tag"
              className="rich-tag rich-tag-add"
              onClick={onStartAddingTag}
              type="button"
            >
              +
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export default PageMetadataEditor;
