import { describe, expect, it, vi } from "vitest";

import { createNativeHistoryRefreshPoll } from "../nativeHistoryAutoRefresh";

vi.mock("../nativeTranscriptReconcile", () => ({
  reconcileNativeTranscript: vi.fn(),
}));

function setup() {
  const state = {
    current: true,
    generation: 0,
    time: 0,
    revision: "v1" as string | null | undefined,
    loaded: undefined as { revision: string; generation: number } | undefined,
  };
  const refresh = vi.fn(
    async (_signal: AbortSignal, _isCurrent: () => boolean) => {}
  );
  const readRevision = vi.fn(async () => state.revision);
  const poller = createNativeHistoryRefreshPoll({
    isCurrent: () => state.current,
    generation: () => state.generation,
    readRevision,
    loadedRevision: () => state.loaded,
    refresh,
    now: () => state.time,
  });
  const settle = async () => {
    await poller.poll();
    state.time += 30_000;
    await poller.poll();
  };
  return { state, refresh, readRevision, poller, settle };
}

describe("managed native history refresh", () => {
  it("waits for stable revisions and performs no history reads while unchanged", async () => {
    const t = setup();
    await t.settle();
    expect(t.refresh).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) await t.poller.poll();
    expect(t.refresh).toHaveBeenCalledTimes(1);
    t.state.revision = "v2";
    await t.poller.poll();
    t.state.revision = "v3";
    await t.poller.poll();
    expect(t.refresh).toHaveBeenCalledTimes(1);
    t.state.time += 30_000;
    await t.poller.poll();
    expect(t.refresh).toHaveBeenCalledTimes(2);
  });

  it("inherits an applied cold-load revision without parsing unchanged history again", async () => {
    const t = setup();
    t.state.loaded = { revision: "v1", generation: 0 };
    await t.settle();
    for (let i = 0; i < 20; i++) await t.poller.poll();
    expect(t.refresh).not.toHaveBeenCalled();
    t.state.revision = "v2";
    await t.settle();
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("does not mistake a first probe after an external append for loaded data", async () => {
    const t = setup();
    t.state.loaded = { revision: "v1", generation: 0 };
    t.state.revision = "v2";
    await t.settle();
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("rejects a cold-load revision from an older turn generation", async () => {
    const t = setup();
    t.state.loaded = { revision: "v1", generation: 0 };
    t.state.generation = 1;
    await t.settle();
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("skips legacy/unbound files and recovers after binding", async () => {
    const t = setup();
    t.state.revision = undefined;
    await t.settle();
    t.state.revision = null;
    await t.settle();
    expect(t.refresh).not.toHaveBeenCalled();
    t.state.revision = "bound";
    await t.settle();
    expect(t.refresh).toHaveBeenCalledOnce();
  });

  it("single-flights probes and discards a probe after a new turn or navigation", async () => {
    const t = setup();
    let finish!: (revision: string) => void;
    t.readRevision.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = t.poller.poll();
    await t.poller.poll();
    expect(t.readRevision).toHaveBeenCalledOnce();
    t.state.generation++;
    finish("v1");
    await pending;
    expect(t.refresh).not.toHaveBeenCalled();
    t.state.current = false;
    await t.poller.poll();
    expect(t.readRevision).toHaveBeenCalledOnce();
  });

  it("aborts an in-flight read on hide/dispose and retries instead of acknowledging it", async () => {
    const t = setup();
    await t.poller.poll();
    t.state.time += 30_000;
    let finish!: () => void;
    t.refresh.mockImplementationOnce(async (signal, isCurrent) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      expect(signal.aborted).toBe(true);
      expect(isCurrent()).toBe(false);
    });
    const pending = t.poller.poll();
    await Promise.resolve();
    t.poller.abort();
    finish();
    await pending;
    await t.poller.poll();
    expect(t.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not cache a file that changed during reconciliation", async () => {
    const t = setup();
    t.refresh.mockImplementationOnce(async () => {
      t.state.revision = "v2";
    });
    await t.settle();
    await t.settle();
    expect(t.refresh).toHaveBeenCalledTimes(2);
  });
});
