import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { tagsFromDraft } from "./editorText";

type UseTagEditorArgs = {
  resetKey: string;
  tags: string[];
  onChangeTags: (tags: string[]) => void;
};

export function useTagEditor({ resetKey, tags, onChangeTags }: UseTagEditorArgs) {
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsAddingTag(false);
    setTagDraft("");
  }, [resetKey]);

  useEffect(() => {
    if (isAddingTag) {
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }, [isAddingTag]);

  function commitTagDraft() {
    const nextTags = tagsFromDraft(tagDraft);
    const nextTag = nextTags[0];

    if (nextTag && !tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      onChangeTags([...tags, nextTag]);
    }

    setTagDraft("");
    setIsAddingTag(false);
  }

  function removeTag(tagToRemove: string) {
    onChangeTags(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
      return;
    }

    if (event.key === "Escape") {
      setTagDraft("");
      setIsAddingTag(false);
    }
  }

  return {
    commitTagDraft,
    handleTagInputKeyDown,
    isAddingTag,
    removeTag,
    setTagDraft,
    startAddingTag: () => setIsAddingTag(true),
    tagDraft,
    tagInputRef
  };
}

export type TagEditorController = ReturnType<typeof useTagEditor>;
