import { beforeEach, expect, it, vi } from "vitest";

import { ensureSessionHistoryInStore } from "../ensureSessionHistoryInStore";

const mocks = vi.hoisted(() => ({
  latest: vi.fn(),
  snapshot: vi.fn(),
  set: vi.fn(),
  cache: vi.fn(),
  source: vi.fn(),
  cursor: vi.fn(),
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getLatestSessionSnapshot: mocks.latest,
    getSnapshot: mocks.snapshot,
    set: mocks.set,
    loadFromCache: mocks.cache,
  },
}));
vi.mock("../adapters/externalHistoryAdapter", () => ({
  externalHistoryAdapter: { loadHistory: mocks.source },
}));
vi.mock("../adapters/cursorIdeAdapter", () => ({
  ensureCursorIdeEventsInStore: mocks.cursor,
}));
const child = "codexapp-rollout-child";
const empty = { version: 0, eventCount: 0 };
const history = [{ id: "message", displayText: "Child result" }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.snapshot.mockResolvedValue(empty);
  mocks.source.mockResolvedValue(history);
  mocks.set.mockResolvedValue(undefined);
});

it("hydrates a cold imported child from its source even when internal cache is empty", async () => {
  await ensureSessionHistoryInStore(child);
  expect(mocks.source).toHaveBeenCalledWith(child, expect.any(AbortSignal));
  expect(mocks.cache).not.toHaveBeenCalled();
  expect(mocks.set).toHaveBeenCalledWith(history, child, 0);
  expect(mocks.snapshot).toHaveBeenCalledTimes(2);
});

it("does not accept a cached empty snapshot as loaded history", async () => {
  mocks.latest.mockReturnValue(empty);
  await ensureSessionHistoryInStore(child);
  expect(mocks.set).toHaveBeenCalledWith(history, child, 0);
});

it("shares one source load and write across simultaneous scoped consumers", async () => {
  let finish!: (value: typeof history) => void;
  mocks.source.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const first = ensureSessionHistoryInStore(child);
  const second = ensureSessionHistoryInStore(child);
  expect(second).toBe(first);
  await Promise.resolve();
  finish(history);
  await Promise.all([first, second]);
  expect(mocks.source).toHaveBeenCalledOnce();
  expect(mocks.set).toHaveBeenCalledOnce();
});

it("preserves native loaded pages on reopen and retry, even without a JS cache", async () => {
  mocks.snapshot.mockResolvedValue({ version: 8, eventCount: 300 });
  await ensureSessionHistoryInStore(child);
  await ensureSessionHistoryInStore(child, { forceReload: true });
  expect(mocks.source).not.toHaveBeenCalled();
  expect(mocks.set).not.toHaveBeenCalled();
});

it("preserves a newer session snapshot that arrives during source loading", async () => {
  mocks.latest
    .mockReturnValueOnce(empty)
    .mockReturnValue({ version: 3, eventCount: 200 });
  await ensureSessionHistoryInStore(child);
  expect(mocks.set).not.toHaveBeenCalled();
});

it("honors a native version conflict before the newer snapshot is broadcast", async () => {
  mocks.snapshot
    .mockResolvedValueOnce(empty)
    .mockResolvedValue({ version: 1, eventCount: 50 });
  mocks.set.mockRejectedValue(
    new Error("EventStore changed during native history refresh")
  );
  await expect(ensureSessionHistoryInStore(child)).resolves.toBeUndefined();
  expect(mocks.set).toHaveBeenCalledWith(history, child, 0);
});

it("releases failed loads so retry can hydrate instead of retaining an empty result", async () => {
  mocks.source.mockRejectedValueOnce(new Error("source unavailable"));
  await expect(ensureSessionHistoryInStore(child)).rejects.toThrow(
    "source unavailable"
  );
  await ensureSessionHistoryInStore(child, { forceReload: true });
  expect(mocks.source).toHaveBeenCalledTimes(2);
  expect(mocks.set).toHaveBeenCalledOnce();
});

it("propagates a failed store write without mistaking it for new activity", async () => {
  mocks.set.mockRejectedValue(new Error("write failed"));
  await expect(ensureSessionHistoryInStore(child)).rejects.toThrow(
    "write failed"
  );
});

it("retains existing native and Cursor hydration ownership", async () => {
  await ensureSessionHistoryInStore("cliagent-child");
  await ensureSessionHistoryInStore("cursoride-child", { forceReload: true });
  expect(mocks.cache).toHaveBeenCalledWith("cliagent-child");
  expect(mocks.cursor).toHaveBeenCalledWith("cursoride-child", {
    forceReload: true,
  });
  expect(mocks.source).not.toHaveBeenCalled();
});
