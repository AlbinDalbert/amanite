import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import type { EditorState } from "lexical";
import { useCallback, useEffect, useRef } from "react";
import { registerEditorFlush, settleEditorComposition, type EditorSnapshot } from "./editorFlush";
import { AMANITE_DERIVED_LINK_TAG, AMANITE_HTML_LOAD_TAG, importHtmlIntoEditorInBatches } from "./editorHtml";
import { cleanEditorHtml } from "./editorHtml";
import { readEditorModel, type EditorModelSnapshot } from "./editorModel";
import { AMANITE_VIEW_SYNC_TAG, type SharedDocumentEditorSession } from "./sharedDocumentEditor";
import { measureDataflow, nextDataflowRequestId, recordDataflowEvent } from "@/lib/dataflowTelemetry";

type Props = {
  bodyHtml: string;
  documentId?: string;
  sourceIncarnation?: number;
  pagePath: string;
  sharedSession?: SharedDocumentEditorSession;
  onChange?: (html: string) => void;
  onModelChange?: (snapshot: EditorModelSnapshot) => void;
  onRevision?: (revision: number) => void;
  onSnapshot?: (snapshot: EditorSnapshot) => void;
  onLoaded?: () => void;
  onLoading?: () => void;
};

function HtmlBridgePlugin({ bodyHtml, sourceIncarnation, documentId, pagePath, sharedSession, onChange, onModelChange, onRevision, onSnapshot, onLoaded, onLoading }: Props) {
  const [editor] = useLexicalComposerContext();
  const editorDocumentId = documentId ?? pagePath;
  const loadedPage = useRef<string | null>(null);
  const importing = useRef(false);
  const bodyHtmlRef = useRef(bodyHtml);
  bodyHtmlRef.current = bodyHtml;
  const sourceHtmlDependency = sharedSession && sourceIncarnation != null ? null : bodyHtml;
  const lastHtml = useRef(bodyHtml);
  const onChangeRef = useRef(onChange);
  const onModelChangeRef = useRef(onModelChange);
  const onRevisionRef = useRef(onRevision);
  const onSnapshotRef = useRef(onSnapshot);
  const onLoadedRef = useRef(onLoaded);
  const onLoadingRef = useRef(onLoading);
  const revisionRef = useRef(0);
  const pendingState = useRef<EditorState | null>(null);
  const pendingRevision = useRef<number | null>(null);
  const lastSnapshot = useRef<EditorSnapshot | null>(null);
  onChangeRef.current = onChange;
  onModelChangeRef.current = onModelChange;
  onRevisionRef.current = onRevision;
  onSnapshotRef.current = onSnapshot;
  onLoadedRef.current = onLoaded;
  onLoadingRef.current = onLoading;

  const currentRevision = useCallback(() => sharedSession?.getRevision() ?? revisionRef.current, [sharedSession]);

  const reportModel = useCallback((state: EditorState, revision: number) => {
    const model = sharedSession?.getModel
      ? sharedSession.getModel(state, revision)
      : measureDataflow("editor.full-model-scan", { documentId: editorDocumentId, revision }, () => readEditorModel(state, revision));
    onModelChangeRef.current?.(model);
  }, [editorDocumentId, sharedSession]);

  const exportPendingState = useCallback((minimumRevision = 0, requestedId?: string): EditorSnapshot | void => {
    if (importing.current) return;
    const requestId = requestedId ?? nextDataflowRequestId("snapshot");
    const reuseSnapshot = (snapshot: EditorSnapshot | null) => snapshot ? { ...snapshot, requestId } : undefined;
    const editorRevision = currentRevision();
    const pendingAt = pendingRevision.current ?? -1;
    const revision = Math.max(editorRevision, pendingAt);
    if (!pendingState.current && lastSnapshot.current && lastSnapshot.current.revision >= minimumRevision && lastSnapshot.current.revision >= revision) return reuseSnapshot(lastSnapshot.current);
    if (revision < minimumRevision) return lastSnapshot.current?.revision === revision ? reuseSnapshot(lastSnapshot.current) : undefined;
    const state = pendingState.current && pendingAt >= editorRevision
      ? pendingState.current
      : minimumRevision > 0 && revision > 0
        ? editor.getEditorState()
        : null;
    if (!state) return lastSnapshot.current && lastSnapshot.current.revision >= minimumRevision ? reuseSnapshot(lastSnapshot.current) : undefined;
    pendingState.current = null;
    pendingRevision.current = null;
    recordDataflowEvent({ documentId: editorDocumentId, name: "snapshot.request", requestId, revision, status: "start" });
    const html = measureDataflow("editor.full-export", { documentId: editorDocumentId, requestId, revision }, () => state.read(() => cleanEditorHtml($generateHtmlFromNodes(editor)), { editor }));
    const snapshot = {
      bodyHtml: html,
      documentId: editorDocumentId,
      incarnation: sharedSession?.getIncarnation?.() ?? 1,
      projectGeneration: sharedSession?.projectGeneration ?? 0,
      requestId,
      revision
    };
    lastSnapshot.current = snapshot;
    lastHtml.current = html;
    sharedSession?.acceptBodyHtml(html);
    onSnapshotRef.current?.(snapshot);
    onChangeRef.current?.(html);
    recordDataflowEvent({ bytes: new TextEncoder().encode(html).byteLength, documentId: editorDocumentId, name: "snapshot.request", requestId, revision, status: "success" });
    return snapshot;
  }, [currentRevision, editor, editorDocumentId]);

  useEffect(() => {
    const bodyHtml = bodyHtmlRef.current;
    // Buffer snapshots can arrive out of order relative to live Lexical edits.
    // Only a new source incarnation authorizes replacing an initialized editor.
    if (sharedSession?.initialized && sourceIncarnation != null
      && sourceIncarnation <= sharedSession.getIncarnation()) {
      if (loadedPage.current === null) {
        loadedPage.current = editorDocumentId;
        reportModel(editor.getEditorState(), currentRevision());
        onLoadedRef.current?.();
      }
      return;
    }
    if (sourceIncarnation == null && sharedSession?.initialized && loadedPage.current === null && bodyHtml === sharedSession.getMirrorHtml()) {
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      sharedSession.markInitialized();
      reportModel(editor.getEditorState(), currentRevision());
      onLoadedRef.current?.();
      return;
    }
    if ((sourceIncarnation == null || !sharedSession) && loadedPage.current === editorDocumentId && bodyHtml === lastHtml.current) return;
    importing.current = true;
    pendingState.current = null;
    pendingRevision.current = null;
    onLoadingRef.current?.();
    const importRequestId = nextDataflowRequestId("import");
    const importStarted = performance.now();
    recordDataflowEvent({ bytes: new TextEncoder().encode(bodyHtml).byteLength, documentId: editorDocumentId, name: "editor.import", requestId: importRequestId, status: "start" });
    if (sharedSession?.initialized) sharedSession.replaceSource(sourceIncarnation);
    lastSnapshot.current = null;
    const cancelImport = importHtmlIntoEditorInBatches(editor, bodyHtml, () => {
      importing.current = false;
      loadedPage.current = editorDocumentId;
      lastHtml.current = bodyHtml;
      sharedSession?.acceptBodyHtml(bodyHtml);
      sharedSession?.markInitialized();
      reportModel(editor.getEditorState(), currentRevision());
      onLoadedRef.current?.();
      recordDataflowEvent({ documentId: editorDocumentId, durationMs: performance.now() - importStarted, name: "editor.import", requestId: importRequestId, revision: currentRevision(), status: "success" });
    });
    return cancelImport;
  }, [sourceHtmlDependency, currentRevision, editor, editorDocumentId, pagePath, reportModel, sharedSession, sourceIncarnation]);

  const getRevision = useCallback(() => currentRevision(), [currentRevision]);

  useEffect(() => registerEditorFlush(editorDocumentId, {
    documentId: editorDocumentId,
    incarnation: sharedSession?.getIncarnation?.() ?? 1,
    projectGeneration: sharedSession?.projectGeneration ?? 0,
    flush: async (minimumRevision, requestId) => {
      if (editor.isComposing()) await settleEditorComposition(editor.getRootElement());
      return exportPendingState(minimumRevision, requestId);
    },
    getRevision
  }), [editor, editorDocumentId, exportPendingState, getRevision, sharedSession]);

  function handleChange(state: EditorState, _editor: unknown, tags: Set<string>) {
    if (tags.has(AMANITE_HTML_LOAD_TAG) || tags.has(AMANITE_DERIVED_LINK_TAG) || tags.has(AMANITE_VIEW_SYNC_TAG)) return;
    const revision = sharedSession?.nextRevision() ?? (revisionRef.current += 1);
    onRevisionRef.current?.(revision);
    reportModel(state, revision);
    pendingState.current = state;
    pendingRevision.current = revision;
  }

  return <OnChangePlugin ignoreHistoryMergeTagChange ignoreSelectionChange onChange={handleChange} />;
}

export default HtmlBridgePlugin;
