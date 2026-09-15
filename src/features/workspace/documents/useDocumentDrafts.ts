import { useCallback, useEffect, useRef } from "react";
import { writePageDraftSource } from "@/app/pageDrafts";
import { requestEditorSnapshot } from "@/features/editor/components/editorFlush";
import { writeEditablePage } from "@/features/editor/components/pageSource";
import { errorMessage, type DocumentBuffer, type DocumentBuffers } from "./documentBuffers";
import { nextDataflowRequestId, recordDataflowEvent } from "@/lib/dataflowTelemetry";

export const RECOVERY_IDLE_DELAY_MS = 180;
export const RECOVERY_MAX_LAG_MS = 2_000;
export const AUTOSAVE_IDLE_DELAY_MS = 900;
export const AUTOSAVE_MAX_LAG_MS = 2_000;
export const RECOVERY_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

type RevisionSchedule = {
  requestedRevision: number;
  capturedRevision: number;
  queuedRevision: number;
  confirmedRevision: number;
  failedRevision: number | null;
  firstRequestedAt: number | null;
  requestId: string | null;
  retryCount: number;
  idleTimer: number | null;
  maxTimer: number | null;
  running: Promise<void> | null;
};

type Options = {
  autoSave: boolean;
  buffers: DocumentBuffers;
  projectRoot: string;
  saveDocument: (path: string) => Promise<boolean>;
  onDraftConfirmed?: (documentId: string, revision: number) => void;
  onDraftError?: (documentId: string, message: string) => void;
  onStorageError: (message: string | null) => void;
};

function clearSchedule(schedule: RevisionSchedule) {
  if (schedule.idleTimer != null) window.clearTimeout(schedule.idleTimer);
  if (schedule.maxTimer != null) window.clearTimeout(schedule.maxTimer);
  schedule.idleTimer = null;
  schedule.maxTimer = null;
}

function newSchedule(): RevisionSchedule {
  return { requestedRevision: 0, capturedRevision: 0, queuedRevision: 0, confirmedRevision: 0, failedRevision: null, firstRequestedAt: null, requestId: null, retryCount: 0, idleTimer: null, maxTimer: null, running: null };
}

export function useDocumentDrafts({ autoSave, buffers, projectRoot, saveDocument, onDraftConfirmed, onDraftError, onStorageError }: Options) {
  const latestBuffersRef = useRef(buffers);
  const latestProjectRootRef = useRef(projectRoot);
  const draftSchedulesRef = useRef(new Map<string, RevisionSchedule>());
  const saveSchedulesRef = useRef(new Map<string, RevisionSchedule>());
  const scheduleDraftRef = useRef<(buffer: DocumentBuffer) => void>(() => undefined);
  const scheduleSaveRef = useRef<(buffer: DocumentBuffer) => void>(() => undefined);

  latestBuffersRef.current = buffers;
  latestProjectRootRef.current = projectRoot;

  const findBuffer = useCallback((documentId: string) => Object.values(latestBuffersRef.current).find((buffer) => buffer.documentId === documentId), []);

  const reportDraftError = useCallback((documentId: string, message: string) => {
    onDraftError?.(documentId, message);
    onStorageError(message);
  }, [onDraftError, onStorageError]);

  const flushDraft = useCallback((documentId: string) => {
    const schedule = draftSchedulesRef.current.get(documentId) ?? newSchedule();
    draftSchedulesRef.current.set(documentId, schedule);
    if (schedule.running) return schedule.running;
    clearSchedule(schedule);

    const buffer = findBuffer(documentId);
    if (!buffer || !buffer.dirty || buffer.revision <= Math.max(buffer.draftedRevision, schedule.confirmedRevision)) return Promise.resolve();
    const targetRevision = buffer.revision;
    const requestId = schedule.requestId ?? nextDataflowRequestId("draft");
    const started = schedule.firstRequestedAt ?? performance.now();
    schedule.capturedRevision = targetRevision;
    const task = (async () => {
      try {
        const snapshot = await requestEditorSnapshot(buffer.documentId, targetRevision);
        const latest = findBuffer(documentId);
        if (!latest) return;
        if (snapshot && (snapshot.documentId !== latest.documentId
          || snapshot.projectGeneration !== latest.projectGeneration
          || snapshot.incarnation < latest.incarnation)) {
          reportDraftError(documentId, `The recovery snapshot for ${latest.path} belongs to an obsolete document incarnation.`);
          schedule.failedRevision = targetRevision;
          schedule.retryCount += 1;
          return;
        }
        if (snapshot && snapshot.revision < targetRevision) {
          reportDraftError(documentId, `The recovery snapshot for ${latest.path} is behind revision ${targetRevision}.`);
          schedule.failedRevision = targetRevision;
          schedule.retryCount += 1;
          return;
        }
        const revision = snapshot?.revision ?? (latest.snapshotRevision >= targetRevision ? latest.snapshotRevision : 0);
        if (!revision) {
          reportDraftError(documentId, `The recovery snapshot for ${latest.path} is not available yet.`);
          schedule.failedRevision = targetRevision;
          schedule.retryCount += 1;
          return;
        }
        const source = snapshot
          ? writeEditablePage(latest.source, latest.title, snapshot.bodyHtml, latest.hasTitleHeading)
          : latest.source;
        schedule.queuedRevision = revision;
        const result = await writePageDraftSource(latestProjectRootRef.current, latest.path, source, latest.contentHash ?? "", revision);
        if (result.status === "written") {
          const confirmedLag = performance.now() - started;
          schedule.confirmedRevision = result.revision;
          schedule.failedRevision = null;
          schedule.retryCount = 0;
          if (result.revision >= schedule.requestedRevision) {
            schedule.firstRequestedAt = null;
            schedule.requestId = null;
          }
          recordDataflowEvent({ documentId, durationMs: confirmedLag, name: "draft.confirmed", requestId, revision: result.revision, status: "success" });
          onDraftConfirmed?.(documentId, result.revision);
          if (confirmedLag > RECOVERY_MAX_LAG_MS) {
            reportDraftError(documentId, `Recovery for ${latest.path} completed after ${Math.round(confirmedLag)} ms, beyond the ${RECOVERY_MAX_LAG_MS} ms target.`);
          } else {
            onStorageError(null);
          }
        }
      } catch (error) {
        recordDataflowEvent({ documentId, durationMs: performance.now() - started, name: "draft.confirmed", requestId, revision: targetRevision, status: "failure" });
        const message = errorMessage(error);
        reportDraftError(documentId, message);
        schedule.failedRevision = targetRevision;
        schedule.retryCount += 1;
      }
    })();
    let settled!: Promise<void>;
    settled = task.finally(() => {
      if (schedule.running === settled) schedule.running = null;
      const latest = findBuffer(documentId);
      if (!latest || !latest.dirty || latest.revision <= Math.max(latest.draftedRevision, schedule.confirmedRevision)) {
        schedule.firstRequestedAt = null;
        schedule.requestId = null;
        return;
      }
      if (schedule.failedRevision === latest.revision && schedule.retryCount <= RECOVERY_RETRY_DELAYS_MS.length) {
        const delay = RECOVERY_RETRY_DELAYS_MS[schedule.retryCount - 1];
        schedule.idleTimer = window.setTimeout(() => { schedule.idleTimer = null; void flushDraft(documentId); }, delay);
        return;
      }
      if (schedule.failedRevision !== latest.revision) scheduleDraftRef.current(latest);
    });
    schedule.running = settled;
    return settled;
  }, [findBuffer, onDraftConfirmed, onStorageError, reportDraftError]);

  const flushSave = useCallback((documentId: string) => {
    const schedule = saveSchedulesRef.current.get(documentId) ?? newSchedule();
    saveSchedulesRef.current.set(documentId, schedule);
    if (schedule.running) return schedule.running;
    clearSchedule(schedule);

    const buffer = findBuffer(documentId);
    if (!buffer || !buffer.dirty || buffer.conflict || buffer.operation) return Promise.resolve();
    const targetRevision = buffer.revision;
    const task = (async () => {
      try {
        const succeeded = await saveDocument(buffer.path);
        if (!succeeded) schedule.failedRevision = targetRevision;
      } catch (error) {
        schedule.failedRevision = targetRevision;
        reportDraftError(documentId, errorMessage(error));
      }
    })();
    let settled!: Promise<void>;
    settled = task.finally(() => {
      if (schedule.running === settled) schedule.running = null;
      const latest = findBuffer(documentId);
      if (latest && latest.dirty && !latest.conflict && !latest.operation && latest.revision > latest.savedRevision && schedule.failedRevision !== latest.revision) scheduleSaveRef.current(latest);
    });
    schedule.running = settled;
    return settled;
  }, [findBuffer, reportDraftError, saveDocument]);

  const armSchedule = useCallback((map: Map<string, RevisionSchedule>, buffer: DocumentBuffer, idleDelay: number, maxLag: number, flush: (documentId: string) => Promise<void>) => {
    const schedule = map.get(buffer.documentId) ?? newSchedule();
    map.set(buffer.documentId, schedule);
    if (buffer.revision > schedule.requestedRevision) {
      if (schedule.firstRequestedAt == null) {
        schedule.firstRequestedAt = performance.now();
        schedule.requestId = nextDataflowRequestId(map === draftSchedulesRef.current ? "draft" : "autosave");
        if (map === draftSchedulesRef.current) recordDataflowEvent({ documentId: buffer.documentId, name: "draft.request", requestId: schedule.requestId, revision: buffer.revision, status: "start" });
      }
      schedule.requestedRevision = buffer.revision;
      schedule.failedRevision = null;
      schedule.retryCount = 0;
      if (schedule.running) return;
      if (schedule.idleTimer != null) window.clearTimeout(schedule.idleTimer);
      schedule.idleTimer = window.setTimeout(() => { schedule.idleTimer = null; void flush(buffer.documentId); }, idleDelay);
    } else if (schedule.failedRevision === buffer.revision) {
      return;
    } else if (schedule.idleTimer == null) {
      schedule.idleTimer = window.setTimeout(() => { schedule.idleTimer = null; void flush(buffer.documentId); }, idleDelay);
    }
    if (schedule.running) return;
    if (schedule.maxTimer == null) {
      const elapsed = schedule.firstRequestedAt == null ? 0 : performance.now() - schedule.firstRequestedAt;
      schedule.maxTimer = window.setTimeout(() => { schedule.maxTimer = null; void flush(buffer.documentId); }, Math.max(0, maxLag - elapsed));
    }
  }, []);

  const scheduleDraft = useCallback((buffer: DocumentBuffer) => {
    armSchedule(draftSchedulesRef.current, buffer, RECOVERY_IDLE_DELAY_MS, RECOVERY_MAX_LAG_MS, flushDraft);
  }, [armSchedule, flushDraft]);
  const scheduleSave = useCallback((buffer: DocumentBuffer) => {
    armSchedule(saveSchedulesRef.current, buffer, AUTOSAVE_IDLE_DELAY_MS, AUTOSAVE_MAX_LAG_MS, flushSave);
  }, [armSchedule, flushSave]);
  scheduleDraftRef.current = scheduleDraft;
  scheduleSaveRef.current = scheduleSave;

  useEffect(() => {
    const active = new Set<string>();
    for (const buffer of Object.values(buffers)) {
      active.add(buffer.documentId);
      const schedule = draftSchedulesRef.current.get(buffer.documentId);
      if (buffer.dirty && buffer.revision > Math.max(buffer.draftedRevision, schedule?.confirmedRevision ?? 0)) scheduleDraft(buffer);
      else {
        if (schedule && !schedule.running) clearSchedule(schedule);
      }
      if (autoSave && buffer.dirty && !buffer.conflict && !buffer.operation && buffer.revision > buffer.savedRevision) scheduleSave(buffer);
      else {
        const schedule = saveSchedulesRef.current.get(buffer.documentId);
        if (schedule && !schedule.running) clearSchedule(schedule);
      }
    }
    for (const [documentId, schedule] of draftSchedulesRef.current) {
      if (!active.has(documentId) && !schedule.running) clearSchedule(schedule);
    }
    for (const [documentId, schedule] of saveSchedulesRef.current) {
      if (!active.has(documentId) && !schedule.running) clearSchedule(schedule);
    }
  }, [autoSave, buffers, projectRoot, scheduleDraft, scheduleSave]);

  useEffect(() => () => {
    latestProjectRootRef.current = projectRoot;
    for (const schedule of [...draftSchedulesRef.current.values(), ...saveSchedulesRef.current.values()]) clearSchedule(schedule);
  }, [projectRoot]);
}
