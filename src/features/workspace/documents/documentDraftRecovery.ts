import { clearPageDraft, readPageDraft } from "@/app/pageDrafts";

type Options = {
  checkDraft: boolean;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  pagePath: string;
  projectRoot: string;
  source: string;
  sourceHash: string | null | undefined;
};

export async function resolveDocumentDraft({ checkDraft, onRequestConfirmation, pagePath, projectRoot, source, sourceHash }: Options) {
  if (!checkDraft) return { dirty: false, source };

  const draft = await readPageDraft(projectRoot, pagePath);
  if (!draft) return { dirty: false, source };
  if (draft.source === source) {
    void clearPageDraft(projectRoot, pagePath);
    return { dirty: false, source };
  }

  const baselineMatches = Boolean(draft.baseSourceHash && draft.baseSourceHash === sourceHash);
  const recover = await onRequestConfirmation(
    baselineMatches
      ? `Recover the unsaved draft for ${pagePath}?`
      : `The page changed on disk after this draft was created. Replace the disk version with the draft for ${pagePath}?`,
    baselineMatches ? "Recover draft" : "Replace with draft"
  );
  if (recover) return { dirty: true, source: draft.source };

  void clearPageDraft(projectRoot, pagePath);
  return { dirty: false, source };
}
