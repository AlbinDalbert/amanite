import { describe, expect, it } from "vitest";
import { clearDataflowEvents, measureDataflow, measureDataflowAsync, nextDataflowRequestId, readDataflowEvents, recordDataflowEvent } from "./dataflowTelemetry";

describe("data-flow telemetry", () => {
  it("records bounded, correlated measurements", async () => {
    clearDataflowEvents();
    const requestId = nextDataflowRequestId("snapshot");
    recordDataflowEvent({ documentId: "document-1", name: "snapshot.request", requestId, revision: 4, status: "start" });
    expect(measureDataflow("model.scan", { documentId: "document-1", revision: 4 }, () => 7)).toBe(7);
    await expect(measureDataflowAsync("ipc.read", { bytes: 12, requestId }, async () => "ok")).resolves.toBe("ok");

    expect(readDataflowEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "snapshot.request", requestId, revision: 4 }),
      expect.objectContaining({ durationMs: expect.any(Number), name: "model.scan" }),
      expect.objectContaining({ bytes: 12, name: "ipc.read", status: "success" })
    ]));
  });
});
