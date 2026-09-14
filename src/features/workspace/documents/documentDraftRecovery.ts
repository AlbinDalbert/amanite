import { clearPageDraft, readPageDraft } from "@/app/pageDrafts";

type Options = {
  checkDraft: boolean;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  pagePath: string;
  projectRoot: string;
  source: string;
  sourceHash: string | null | undefined;
  isCurrent?: () => boolean;
};

export async function resolveDocumentDraft({ checkDraft, isCurrent, onRequestConfirmation, pagePath, projectRoot, source, sourceHash }: Options) {
  const stillCurrent = () => !isCurrent || isCurrent();
  if (!checkDraft) return { dirty: false, draftedRevision: 0, revision: 0, source };
  if (!stillCurrent()) return { dirty: false, draftedRevision: 0, revision: 0, source };

  const draft = await readPageDraft(projectRoot, pagePath);
  if (!draft) return { dirty: false, draftedRevision: 0, revision: 0, source };
  if (!stillCurrent()) return { dirty: false, draftedRevision: 0, revision: 0, source };
  if (draft.source === source) {
    if (stillCurrent()) void clearPageDraft(projectRoot, pagePath);
    return { dirty: false, draftedRevision: 0, revision: 0, source };
  }

  if (!stillCurrent()) return { dirty: false, draftedRevision: 0, revision: 0, source };
  const baselineMatches = Boolean(draft.baseSourceHash && draft.baseSourceHash === sourceHash);
  const recover = await onRequestConfirmation(
    baselineMatches
      ? `Recover the unsaved draft for ${pagePath}?`
      : `The page changed on disk after this draft was created. Replace the disk version with the draft for ${pagePath}?`,
    baselineMatches ? "Recover draft" : "Replace with draft"
  );
  if (recover) return { dirty: true, draftedRevision: draft.revision, revision: Math.max(1, draft.revision), source: draft.source };

  if (stillCurrent()) void clearPageDraft(projectRoot, pagePath);
  return { dirty: false, draftedRevision: 0, revision: 0, source };
}
