import { $generateHtmlFromNodes } from "@lexical/html";
import type { LexicalEditor } from "lexical";
import { cleanEditorHtml } from "@/features/editor/components/editorHtml";
import { measureDataflow, nextDataflowRequestId } from "@/lib/dataflowTelemetry";
import type { DocumentCapture, DocumentSession } from "./documentRuntime";

export type EncodedDocumentCapture = Readonly<{
  capture: DocumentCapture;
  bodyHtml: string;
  requestId: string;
}>;

export function captureDocument(session: DocumentSession, requestId = nextDataflowRequestId("document-capture")): DocumentCapture {
  const beforeCapture = session.getSnapshot();
  return measureDataflow("document.capture", {
    documentId: beforeCapture.documentId,
    projectGeneration: beforeCapture.projectGeneration,
    requestId,
    revision: beforeCapture.revision
  }, () => session.capture());
}

export function captureAndEncodeDocument(session: DocumentSession, requestId = nextDataflowRequestId("document-capture")): EncodedDocumentCapture {
  const capture = captureDocument(session, requestId);
  const cached = session.getEncodedState();
  if (cached) return { bodyHtml: cached.bodyHtml, capture, requestId };
  const bodyHtml = encodeDocumentState(capture, session.editor, requestId);
  session.cacheEncodedState(capture, bodyHtml);
  return { bodyHtml, capture, requestId };
}

export function encodeDocumentState(capture: DocumentCapture, editor: LexicalEditor, requestId = nextDataflowRequestId("document-encode")) {
  return measureDataflow("document.encode", {
    documentId: capture.documentId,
    projectGeneration: capture.projectGeneration,
    requestId,
    revision: capture.revision
  }, () => capture.editorState.read(() => cleanEditorHtml($generateHtmlFromNodes(editor)), { editor }));
}
