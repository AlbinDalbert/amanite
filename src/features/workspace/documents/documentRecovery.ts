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
export const AUTOSAVE_IDLE_DELAY_MS = 900;
export const AUTOSAVE_MAX_LAG_MS = 2_000;

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
export type AutosaveWriter = (session: DocumentSession, targetRevision: number) => Promise<boolean>;

type RecoveryCoordinatorOptions = {
  autoSave?: boolean;
  autosave?: AutosaveWriter;
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
  private readonly recoverySchedules = new Map<string, RecoverySchedule>();
  private readonly autosaveSchedules = new Map<string, RecoverySchedule>();
  private readonly sessionUnsubscribers = new Map<string, () => void>();
  private readonly registryUnsubscribe: () => void;
  private autoSaveEnabled: boolean;
  private disposed = false;

  constructor(private readonly options: RecoveryCoordinatorOptions) {
    this.autoSaveEnabled = options.autoSave ?? false;
    this.registryUnsubscribe = options.documentRegistry.subscribe((event) => {
      if (event.kind === "disposed") {
        this.dispose();
        return;
      }
      if (!event.session) return;
      if (event.kind === "opened") this.attach(event.session);
      if (event.kind === "closed") this.detach(event.session);
      if (event.kind === "renamed") {
        this.syncRecovery(event.session);
        this.syncAutosave(event.session);
      }
    });
    for (const session of options.documentRegistry.sessions()) this.attach(session);
  }

  sync() {
    if (this.disposed) return;
    for (const session of this.options.documentRegistry.sessions()) {
      this.syncRecovery(session);
      this.syncAutosave(session);
    }
  }

  setAutoSave(enabled: boolean) {
    if (this.disposed || this.autoSaveEnabled === enabled) return;
    this.autoSaveEnabled = enabled;
    if (!enabled) {
      for (const [documentId, schedule] of this.autosaveSchedules) {
        clearTimers(schedule);
        if (!schedule.running) this.autosaveSchedules.delete(documentId);
      }
      return;
    }
    for (const session of this.options.documentRegistry.sessions()) this.syncAutosave(session);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.registryUnsubscribe();
    for (const unsubscribe of this.sessionUnsubscribers.values()) unsubscribe();
    this.sessionUnsubscribers.clear();
    for (const schedule of [...this.recoverySchedules.values(), ...this.autosaveSchedules.values()]) clearTimers(schedule);
    this.recoverySchedules.clear();
    this.autosaveSchedules.clear();
  }

  private attach(session: DocumentSession) {
    if (this.disposed || this.sessionUnsubscribers.has(session.documentId)) return;
    const unsubscribe = session.subscribe((event) => {
      if (event.kind !== "body" && event.kind !== "title") return;
      this.scheduleRecovery(session, event.revision);
      this.scheduleAutosave(session, event.revision);
    });
    this.sessionUnsubscribers.set(session.documentId, unsubscribe);
    this.syncRecovery(session);
    this.syncAutosave(session);
  }

  private detach(session: DocumentSession) {
    this.sessionUnsubscribers.get(session.documentId)?.();
    this.sessionUnsubscribers.delete(session.documentId);
    const recoverySchedule = this.recoverySchedules.get(session.documentId);
    if (recoverySchedule) clearTimers(recoverySchedule);
    this.recoverySchedules.delete(session.documentId);
    const autosaveSchedule = this.autosaveSchedules.get(session.documentId);
    if (autosaveSchedule) clearTimers(autosaveSchedule);
    this.autosaveSchedules.delete(session.documentId);
  }

  private getBuffer(session: DocumentSession) {
    const snapshot = session.getSnapshot();
    const buffer = this.options.buffersRef.current[snapshot.path];
    if (!buffer || buffer.projectGeneration !== snapshot.projectGeneration) return undefined;
    return buffer;
  }

  private isLive(session: DocumentSession) {
    return !this.disposed && this.options.documentRegistry.getById(session.documentId) === session;
  }

  private hasPendingRecovery(session: DocumentSession, buffer: DocumentBuffer, schedule: RecoverySchedule) {
    const revision = session.getSnapshot().revision;
    return (buffer.dirty || revision > buffer.savedRevision)
      && Math.max(buffer.revision, revision) > Math.max(buffer.draftedRevision, schedule.confirmedRevision);
  }

  private hasPendingAutosave(session: DocumentSession, buffer: DocumentBuffer, schedule: RecoverySchedule) {
    if (!this.autoSaveEnabled || !buffer.nativeDocumentParts || buffer.conflict || buffer.operation) return false;
    const revision = Math.max(buffer.revision, session.getSnapshot().revision);
    return (buffer.dirty || revision > buffer.savedRevision)
      && revision > Math.max(buffer.savedRevision, schedule.confirmedRevision);
  }

  private resetIfIdle(schedule: RecoverySchedule) {
    clearTimers(schedule);
    if (schedule.running) return;
    schedule.firstRequestedAt = null;
    schedule.requestId = null;
    schedule.failedRevision = null;
    schedule.retryCount = 0;
  }

  private syncRecovery(session: DocumentSession) {
    if (!this.isLive(session)) return;
    const schedule = this.recoverySchedules.get(session.documentId) ?? newSchedule();
    this.recoverySchedules.set(session.documentId, schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPendingRecovery(session, buffer, schedule)) this.resetIfIdle(schedule);
    else this.scheduleRecovery(session, Math.max(buffer.revision, session.getSnapshot().revision));
  }

  private syncAutosave(session: DocumentSession) {
    if (!this.isLive(session)) return;
    if (!this.autoSaveEnabled || !this.options.autosave) {
      const schedule = this.autosaveSchedules.get(session.documentId);
      if (schedule) this.resetIfIdle(schedule);
      return;
    }
    const schedule = this.autosaveSchedules.get(session.documentId) ?? newSchedule();
    this.autosaveSchedules.set(session.documentId, schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPendingAutosave(session, buffer, schedule)) this.resetIfIdle(schedule);
    else this.scheduleAutosave(session, Math.max(buffer.revision, session.getSnapshot().revision));
  }

  private scheduleRecovery(session: DocumentSession, revision: number) {
    if (!this.isLive(session)) return;
    const buffer = this.getBuffer(session);
    if (!buffer) return;
    const schedule = this.recoverySchedules.get(session.documentId) ?? newSchedule();
    this.recoverySchedules.set(session.documentId, schedule);
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

  private scheduleAutosave(session: DocumentSession, revision: number) {
    if (!this.autoSaveEnabled || !this.isLive(session) || !this.options.autosave) return;
    const buffer = this.getBuffer(session);
    if (!buffer) return;
    const schedule = this.autosaveSchedules.get(session.documentId) ?? newSchedule();
    this.autosaveSchedules.set(session.documentId, schedule);
    const pendingRevision = Math.max(revision, buffer.revision, session.getSnapshot().revision);
    if (pendingRevision <= Math.max(buffer.savedRevision, schedule.confirmedRevision)) return;
    if (buffer.conflict || buffer.operation) return;

    if (pendingRevision > schedule.requestedRevision) {
      if (schedule.firstRequestedAt == null) {
        schedule.firstRequestedAt = performance.now();
        schedule.requestId = nextDataflowRequestId("autosave");
        recordDataflowEvent({
          documentId: session.documentId,
          name: "autosave.request",
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
        void this.flushAutosave(session);
      }, AUTOSAVE_IDLE_DELAY_MS);
    } else if (schedule.failedRevision === pendingRevision) {
      return;
    } else if (schedule.idleTimer == null && !schedule.running) {
      schedule.idleTimer = window.setTimeout(() => {
        schedule.idleTimer = null;
        void this.flushAutosave(session);
      }, AUTOSAVE_IDLE_DELAY_MS);
    }

    if (schedule.running || schedule.maxTimer != null) return;
    const elapsed = schedule.firstRequestedAt == null ? 0 : performance.now() - schedule.firstRequestedAt;
    schedule.maxTimer = window.setTimeout(() => {
      schedule.maxTimer = null;
      void this.flushAutosave(session);
    }, Math.max(0, AUTOSAVE_MAX_LAG_MS - elapsed));
  }

  private reportError(session: DocumentSession, message: string) {
    const buffer = this.getBuffer(session);
    if (buffer) this.options.onDraftError?.(buffer.documentId, message);
    this.options.onStorageError?.(message);
  }

  private flush(session: DocumentSession) {
    const schedule = this.recoverySchedules.get(session.documentId);
    if (!schedule || schedule.running || !this.isLive(session)) return Promise.resolve();
    clearTimers(schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPendingRecovery(session, buffer, schedule)) {
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
      if (!latest || !this.hasPendingRecovery(session, latest, schedule)) {
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
      if (schedule.failedRevision !== latestRevision) this.scheduleRecovery(session, latestRevision);
    });
    schedule.running = settled;
    return settled;
  }

  private flushAutosave(session: DocumentSession) {
    const schedule = this.autosaveSchedules.get(session.documentId);
    if (!schedule || schedule.running || !this.isLive(session) || !this.autoSaveEnabled || !this.options.autosave) return Promise.resolve();
    clearTimers(schedule);
    const buffer = this.getBuffer(session);
    if (!buffer || !this.hasPendingAutosave(session, buffer, schedule)) {
      this.resetIfIdle(schedule);
      return Promise.resolve();
    }

    const targetRevision = Math.max(schedule.requestedRevision, buffer.revision, session.getSnapshot().revision);
    const requestId = schedule.requestId ?? nextDataflowRequestId("autosave");
    const started = schedule.firstRequestedAt ?? performance.now();
    schedule.capturedRevision = targetRevision;
    const task = (async () => {
      try {
        const succeeded = await this.options.autosave!(session, targetRevision);
        if (!this.isLive(session)) return;
        schedule.queuedRevision = targetRevision;
        if (!succeeded) {
          recordDataflowEvent({
            documentId: session.documentId,
            durationMs: performance.now() - started,
            name: "autosave.confirmed",
            requestId,
            revision: targetRevision,
            status: "failure"
          });
          schedule.failedRevision = targetRevision;
          schedule.retryCount += 1;
          if (targetRevision < schedule.requestedRevision) schedule.requestedRevision = targetRevision;
          schedule.firstRequestedAt = null;
          schedule.requestId = null;
          return;
        }

        schedule.confirmedRevision = Math.max(schedule.confirmedRevision, targetRevision);
        schedule.failedRevision = null;
        schedule.retryCount = 0;
        if (targetRevision < schedule.requestedRevision) schedule.requestedRevision = targetRevision;
        schedule.firstRequestedAt = null;
        schedule.requestId = null;
        recordDataflowEvent({
          documentId: session.documentId,
          durationMs: performance.now() - started,
          name: "autosave.confirmed",
          requestId,
          revision: targetRevision,
          status: "success"
        });
      } catch (error) {
        recordDataflowEvent({
          documentId: session.documentId,
          durationMs: performance.now() - started,
          name: "autosave.confirmed",
          requestId,
          revision: targetRevision,
          status: "failure"
        });
        schedule.failedRevision = targetRevision;
        schedule.retryCount += 1;
        if (targetRevision < schedule.requestedRevision) schedule.requestedRevision = targetRevision;
        schedule.firstRequestedAt = null;
        schedule.requestId = null;
      }
    })();
    let settled!: Promise<void>;
    settled = task.finally(() => {
      if (schedule.running === settled) schedule.running = null;
      if (!this.isLive(session) || !this.autoSaveEnabled) return;
      const latest = this.getBuffer(session);
      if (!latest || !this.hasPendingAutosave(session, latest, schedule)) {
        this.resetIfIdle(schedule);
        return;
      }
      const latestRevision = Math.max(latest.revision, session.getSnapshot().revision);
      if (schedule.failedRevision === latestRevision) return;
      this.scheduleAutosave(session, latestRevision);
    });
    schedule.running = settled;
    return settled;
  }
}
