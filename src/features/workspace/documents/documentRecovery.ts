import type { PageDraftWriteResult } from "@/app/pageDrafts";
import { nextDataflowRequestId, recordDataflowEvent } from "@/lib/dataflowTelemetry";
import type { DocumentBuffer, DocumentBuffers } from "./documentBuffers";
import type { DocumentRegistry, DocumentSession } from "./documentRuntime";

// Keep the recovery target ahead of the normal autosave deadline. These are
// policy values, not a claim that storage can always meet the deadline.
export const RECOVERY_IDLE_DELAY_MS = 500;
export const RECOVERY_MAX_LAG_MS = 2_000;
export const RECOVERY_MAX_WAIT_MS = 1_500;
export const RECOVERY_RETRY_DELAYS_MS = [250, 750, 1_500] as const;

type MutableValue<T> = { current: T };

type RecoverySchedule = {
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

export type RecoveryDraftWriter = (session: DocumentSession, targetRevision: number) => Promise<PageDraftWriteResult | null>;

type RecoveryCoordinatorOptions = {
  buffersRef: MutableValue<DocumentBuffers>;
  documentRegistry: DocumentRegistry;
  onDraftConfirmed?: (documentId: string, revision: number) => void;
  onDraftError?: (documentId: string, message: string) => void;
  onStorageError?: (message: string | null) => void;
  writeDraft: RecoveryDraftWriter;
};

function newSchedule(): RecoverySchedule {
  return {
    requestedRevision: 0,
    capturedRevision: 0,
    queuedRevision: 0,
    confirmedRevision: 0,
    failedRevision: null,
    firstRequestedAt: null,
    requestId: null,
    retryCount: 0,
    idleTimer: null,
    maxTimer: null,
    running: null
  };
}

function clearTimers(schedule: RecoverySchedule) {
  if (schedule.idleTimer != null) window.clearTimeout(schedule.idleTimer);
  if (schedule.maxTimer != null) window.clearTimeout(schedule.maxTimer);
  schedule.idleTimer = null;
  schedule.maxTimer = null;
}

export class DocumentRecoveryCoordinator {
  private readonly schedules = new Map<string, RecoverySchedule>();
  private readonly sessionUnsubscribers = new Map<string, () => void>();
  private readonly registryUnsubscribe: () => void;
  private disposed = false;

  constructor(private readonly options: RecoveryCoordinatorOptions) {
    this.registryUnsubscribe = options.documentRegistry.subscribe((event) => {
      if (event.kind === "disposed") {
        this.dispose();
        return;
      }
      if (!event.session) return;
      if (event.kind === "opened") this.attach(event.session);
      if (event.kind === "closed") this.detach(event.session);
      if (event.kind === "renamed") this.syncSession(event.session);
    });
    for (const session of options.documentRegistry.sessions()) this.attach(session);
  }

  sync() {
    if (this.disposed) return;
    for (const session of this.options.documentRegistry.sessions()) this.syncSession(session);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.registryUnsubscribe();
    for (const unsubscribe of this.sessionUnsubscribers.values()) unsubscribe();
    this.sessionUnsubscribers.clear();
    for (const schedule of this.schedules.values()) clearTimers(schedule);
    this.schedules.clear();
  }

  private attach(session: DocumentSession) {
    if (this.disposed || this.sessionUnsubscribers.has(session.documentId)) return;
    const unsubscribe = session.subscribe((event) => {
      if (event.kind === "body" || event.kind === "title") this.schedule(session, event.revision);
    });
    this.sessionUnsubscribers.set(session.documentId, unsubscribe);
    this.syncSession(session);
  }

  private detach(session: DocumentSession) {
    this.sessionUnsubscribers.get(session.documentId)?.();
    this.sessionUnsubscribers.delete(session.documentId);
    const schedule = this.schedules.get(session.documentId);
    if (schedule) clearTimers(schedule);
    this.schedules.delete(session.documentId);
  }

  private getBuffer(session: DocumentSession) {
    const snapshot = session.getSnapshot();
    const buffer = this.options.buffersRef.current[snapshot.path];
    if (!buffer
      || buffer.projectGeneration !== snapshot.projectGeneration
      || !buffer.nativeDocumentParts) return undefined;
    return buffer;
  }

  private isLive(session: DocumentSession) {
    return !this.disposed && this.options.documentRegistry.getById(session.documentId) === session;
  }

  private hasPending(session: DocumentSession, buffer: DocumentBuffer, schedule: RecoverySchedule) {
    const revision = session.getSnapshot().revision;
    return (buffer.dirty || revision > buffer.savedRevision)
      && Math.max(buffer.revision, revision) > Math.max(buffer.draftedRevision, schedule.confirmedRevision);
  }

  private resetIfIdle(schedule: RecoverySchedule) {
    clearTimers(schedule);
    if (schedule.running) return;
    schedule.firstRequestedAt = null;
    schedule.requestId = null;
    schedule.failedRevision = null;
    schedule.retryCount = 0;
  }

  private syncSession(session: DocumentSession) {
    if (!this.isLive(session)) return;
    const schedule = this.schedules.get(session.documentId) ?? newSchedule();
    this.schedules.set(session.documentId, schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPending(session, buffer, schedule)) this.resetIfIdle(schedule);
    else this.schedule(session, Math.max(buffer.revision, session.getSnapshot().revision));
  }

  private schedule(session: DocumentSession, revision: number) {
    if (!this.isLive(session)) return;
    const buffer = this.getBuffer(session);
    if (!buffer) return;
    const schedule = this.schedules.get(session.documentId) ?? newSchedule();
    this.schedules.set(session.documentId, schedule);
    const pendingRevision = Math.max(revision, buffer.revision, session.getSnapshot().revision);
    if (pendingRevision <= Math.max(buffer.draftedRevision, schedule.confirmedRevision)) return;

    if (pendingRevision > schedule.requestedRevision) {
      if (schedule.firstRequestedAt == null) {
        schedule.firstRequestedAt = performance.now();
        schedule.requestId = nextDataflowRequestId("draft");
        recordDataflowEvent({
          documentId: session.documentId,
          name: "draft.request",
          requestId: schedule.requestId,
          revision: pendingRevision,
          status: "start"
        });
      }
      schedule.requestedRevision = pendingRevision;
      schedule.failedRevision = null;
      schedule.retryCount = 0;
      if (schedule.running) return;
      if (schedule.idleTimer != null) window.clearTimeout(schedule.idleTimer);
      schedule.idleTimer = window.setTimeout(() => {
        schedule.idleTimer = null;
        void this.flush(session);
      }, RECOVERY_IDLE_DELAY_MS);
    } else if (schedule.failedRevision === pendingRevision) {
      return;
    } else if (schedule.idleTimer == null && !schedule.running) {
      schedule.idleTimer = window.setTimeout(() => {
        schedule.idleTimer = null;
        void this.flush(session);
      }, RECOVERY_IDLE_DELAY_MS);
    }

    if (schedule.running || schedule.maxTimer != null) return;
    const elapsed = schedule.firstRequestedAt == null ? 0 : performance.now() - schedule.firstRequestedAt;
    schedule.maxTimer = window.setTimeout(() => {
      schedule.maxTimer = null;
      void this.flush(session);
    }, Math.max(0, RECOVERY_MAX_WAIT_MS - elapsed));
  }

  private reportError(session: DocumentSession, message: string) {
    const buffer = this.getBuffer(session);
    if (buffer) this.options.onDraftError?.(buffer.documentId, message);
    this.options.onStorageError?.(message);
  }

  private flush(session: DocumentSession) {
    const schedule = this.schedules.get(session.documentId);
    if (!schedule || schedule.running || !this.isLive(session)) return Promise.resolve();
    clearTimers(schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPending(session, buffer, schedule)) {
      this.resetIfIdle(schedule);
      return Promise.resolve();
    }

    const targetRevision = Math.max(schedule.requestedRevision, buffer.revision, session.getSnapshot().revision);
    const requestId = schedule.requestId ?? nextDataflowRequestId("draft");
    const started = schedule.firstRequestedAt ?? performance.now();
    schedule.capturedRevision = targetRevision;
    const task = (async () => {
      try {
        const result = await this.options.writeDraft(session, targetRevision);
        if (!this.isLive(session) || !result) return;
        schedule.queuedRevision = result.revision;
        if (result.status !== "written") return;

        const confirmedLag = performance.now() - started;
        schedule.confirmedRevision = Math.max(schedule.confirmedRevision, result.revision);
        schedule.failedRevision = null;
        schedule.retryCount = 0;
        if (result.revision >= schedule.requestedRevision) {
          schedule.firstRequestedAt = null;
          schedule.requestId = null;
        }
        recordDataflowEvent({
          documentId: session.documentId,
          durationMs: confirmedLag,
          name: "draft.confirmed",
          requestId,
          revision: result.revision,
          status: "success"
        });
        const latest = this.getBuffer(session);
        if (latest) this.options.onDraftConfirmed?.(latest.documentId, result.revision);
        if (confirmedLag > RECOVERY_MAX_LAG_MS) {
          this.reportError(session, `Recovery for ${session.getSnapshot().path} completed after ${Math.round(confirmedLag)} ms, beyond the ${RECOVERY_MAX_LAG_MS} ms target.`);
        } else {
          this.options.onStorageError?.(null);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordDataflowEvent({
          documentId: session.documentId,
          durationMs: performance.now() - started,
          name: "draft.confirmed",
          requestId,
          revision: targetRevision,
          status: "failure"
        });
        this.reportError(session, message);
        schedule.failedRevision = targetRevision;
        schedule.retryCount += 1;
      }
    })();
    let settled!: Promise<void>;
    settled = task.finally(() => {
      if (schedule.running === settled) schedule.running = null;
      if (!this.isLive(session)) return;
      const latest = this.getBuffer(session);
      if (!latest || !this.hasPending(session, latest, schedule)) {
        this.resetIfIdle(schedule);
        return;
      }
      const latestRevision = Math.max(latest.revision, session.getSnapshot().revision);
      if (schedule.failedRevision === latestRevision && schedule.retryCount <= RECOVERY_RETRY_DELAYS_MS.length) {
        const delay = RECOVERY_RETRY_DELAYS_MS[schedule.retryCount - 1];
        schedule.idleTimer = window.setTimeout(() => {
          schedule.idleTimer = null;
          void this.flush(session);
        }, delay);
        return;
      }
      if (schedule.failedRevision !== latestRevision) this.schedule(session, latestRevision);
    });
    schedule.running = settled;
    return settled;
  }
}
