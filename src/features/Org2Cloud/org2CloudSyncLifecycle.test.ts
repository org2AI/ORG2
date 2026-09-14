import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markSyncPass } from "./org2CloudSyncJournal";
import { Org2CloudSyncLifecycle } from "./org2CloudSyncLifecycle";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { subscribe: vi.fn(() => () => {}) },
}));
vi.mock("./org2CloudSyncJournal", () => ({
  markSyncPass: vi.fn(),
  recordSyncEvent: vi.fn(),
  describeSyncError: (error: Error) => ({ message: error.message }),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class LifecycleHarness extends Org2CloudSyncLifecycle {
  readonly flights: ReturnType<typeof deferred>[] = [];
  readonly releaseCache = vi.fn();
  protected syncAllOrgs() {
    const flight = deferred();
    this.flights.push(flight);
    return flight.promise;
  }
  protected noteSessionEventActivity() {}
  protected resetSyncState() {}
  protected clearOrgBackoff() {}
  protected clearAllOrgBackoffs() {}
  protected invalidateFullInboundState() {}
  protected afterSyncPass() {
    this.releaseCache();
  }
}

const instances: LifecycleHarness[] = [];
function fixture() {
  vi.useFakeTimers();
  const engine = new LifecycleHarness();
  instances.push(engine);
  engine.start(createStore());
  return engine;
}
afterEach(() => {
  for (const engine of instances.splice(0)) engine.stop();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("cloud pass ownership", () => {
  it.each(["success", "failure"])(
    "old %s cannot unlock or drain a restarted pass",
    async (outcome) => {
      const engine = fixture();
      const oldPass = engine.runSyncPass();
      engine.stop();
      engine.start(createStore());
      let drained = false;
      const newDrain = engine.runSyncPassAndWaitForDrain().then(() => {
        drained = true;
      });
      if (outcome === "success") engine.flights[0].resolve();
      else engine.flights[0].reject(new Error("old transport failed"));
      await oldPass;
      expect(drained).toBe(false);
      expect(engine.releaseCache).not.toHaveBeenCalled();
      expect(markSyncPass).not.toHaveBeenCalled();
      await engine.runSyncPass();
      expect(engine.flights).toHaveLength(2);
      engine.flights[1].resolve();
      await vi.waitFor(() => expect(engine.flights).toHaveLength(3));
      expect(drained).toBe(false);
      engine.flights[2].resolve();
      await newDrain;
      expect(engine.releaseCache).toHaveBeenCalledTimes(2);
    }
  );

  it("stop rejects drain waiters promptly and restart still accepts work", async () => {
    const engine = fixture();
    const cancelled = expect(
      engine.runSyncPassAndWaitForDrain()
    ).rejects.toMatchObject({ name: "AbortError" });
    engine.stop();
    await cancelled;
    engine.start(createStore());
    const next = engine.runSyncPassAndWaitForDrain();
    engine.flights[1].resolve();
    await next;
    expect(engine.releaseCache).toHaveBeenCalledTimes(1);
    engine.flights[0].resolve();
  });

  it("a current transport failure releases ownership so a later recovery drains", async () => {
    const engine = fixture();
    const first = engine.runSyncPassAndWaitForDrain();
    engine.flights[0].reject(new Error("offline"));
    await first;
    expect(markSyncPass).toHaveBeenCalledWith({ success: false });
    const recovery = engine.runSyncPassAndWaitForDrain();
    engine.flights[1].resolve();
    await recovery;
    expect(markSyncPass).toHaveBeenLastCalledWith({ success: true });
  });
});
