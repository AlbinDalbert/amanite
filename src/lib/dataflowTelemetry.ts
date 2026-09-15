export type DataflowEvent = {
  at: number;
  bytes?: number;
  documentId?: string;
  durationMs?: number;
  name: string;
  projectGeneration?: number;
  requestId?: string;
  revision?: number;
  status?: "start" | "success" | "failure" | "superseded";
};

type DataflowTelemetryWindow = Window & {
  __AMANITE_DATAFLOW__?: {
    clear: () => void;
    read: () => DataflowEvent[];
  };
};

const MAX_EVENTS = 20_000;
const events: DataflowEvent[] = [];
let requestSequence = 0;

export function nextDataflowRequestId(prefix: string) {
  requestSequence += 1;
  return `${prefix}-${requestSequence}`;
}

export function recordDataflowEvent(event: Omit<DataflowEvent, "at">) {
  events.push({ ...event, at: performance.now() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function measureDataflow<T>(name: string, detail: Omit<DataflowEvent, "at" | "durationMs" | "name">, task: () => T): T {
  const started = performance.now();
  try {
    return task();
  } finally {
    recordDataflowEvent({ ...detail, durationMs: performance.now() - started, name });
  }
}

export async function measureDataflowAsync<T>(name: string, detail: Omit<DataflowEvent, "at" | "durationMs" | "name" | "status">, task: () => Promise<T>): Promise<T> {
  const started = performance.now();
  recordDataflowEvent({ ...detail, name, status: "start" });
  try {
    const result = await task();
    recordDataflowEvent({ ...detail, durationMs: performance.now() - started, name, status: "success" });
    return result;
  } catch (error) {
    recordDataflowEvent({ ...detail, durationMs: performance.now() - started, name, status: "failure" });
    throw error;
  }
}

export function readDataflowEvents() {
  return events.slice();
}

export function clearDataflowEvents() {
  events.length = 0;
}

if (typeof window !== "undefined") {
  (window as DataflowTelemetryWindow).__AMANITE_DATAFLOW__ = {
    clear: clearDataflowEvents,
    read: readDataflowEvents
  };
}
