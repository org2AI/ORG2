import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearLoadedTurnRegistry,
  isTurnBodyLoaded,
} from "./loadedTurnRegistry";
import { loadSessionTurnBodyIntoStore } from "./turnLoaderRegistry";

const ports = vi.hoisted(() => ({
  read: vi.fn(),
  parse: vi.fn(),
  merge: vi.fn(),
}));
vi.mock("@src/api/tauri/externalHistory", () => ({
  codexAppTurnWindow: ports.read,
  cursorIdeTurnWindow: ports.read,
  importedHistoryTurnWindows: ports.read,
}));
vi.mock("@src/engines/SessionCore/storage/cacheAdapter", () => ({
  loadTurnBody: ports.read,
}));
vi.mock("@src/api/tauri/rpc", () => ({
  rpc: { cli: { history: ports.read } },
}));
vi.mock("@src/engines/SessionCore/ingestion/rustBridge", () => ({
  processChunksRust: ports.parse,
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { mergeRoundWindowEvents: ports.merge },
}));
vi.mock("../sync/adapters/cli/cliHistory", () => ({
  convertResultImages: (event: unknown) => event,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const cases = [
  ["sdeagent", "db"],
  ["codexapp", "window"],
  ["cursoride", "window"],
  ["claudecodeapp", "batch"],
  ["cliagent", "native"],
] as const;
function response(shape: string, id: string | null) {
  const events = id ? [{ id }] : [];
  if (shape === "db") return { events };
  if (shape === "native") return events;
  if (shape === "batch") return [{ turnId: "turn", chunks: events }];
  return { chunks: events };
}
beforeEach(() => {
  vi.resetAllMocks();
  ports.parse.mockImplementation(async (events) => events);
  ports.merge.mockResolvedValue(undefined);
  for (const [prefix] of cases) clearLoadedTurnRegistry(`${prefix}-owner-test`);
});

describe.each(cases)("%s turn loading boundary", (prefix, shape) => {
  const args = { sessionId: `${prefix}-owner-test`, turnId: "turn" };
  it("merges and marks a current body; concurrent requests share the read", async () => {
    const read = deferred<unknown>();
    ports.read.mockReturnValue(read.promise);
    const first = loadSessionTurnBodyIntoStore(args);
    const second = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalledTimes(1));
    read.resolve(response(shape, "current"));
    await Promise.all([first, second]);
    expect(ports.merge).toHaveBeenCalledTimes(1);
    expect(ports.merge).toHaveBeenCalledWith(
      [{ id: "current" }],
      args.sessionId
    );
    expect(isTurnBodyLoaded(args.sessionId, args.turnId)).toBe(true);
  });
  it("does not merge a read invalidated before it returns", async () => {
    const read = deferred<unknown>();
    ports.read.mockReturnValue(read.promise);
    const work = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalledTimes(1));
    clearLoadedTurnRegistry(args.sessionId);
    read.resolve(response(shape, "stale"));
    await work;
    expect(ports.merge).not.toHaveBeenCalled();
    expect(isTurnBodyLoaded(args.sessionId, args.turnId)).toBe(false);
  });
  it("old cleanup cannot remove the new generation's pending request", async () => {
    const old = deferred<unknown>();
    const fresh = deferred<unknown>();
    ports.read
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    const oldWork = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalledTimes(1));
    clearLoadedTurnRegistry(args.sessionId);
    const freshWork = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalledTimes(2));
    old.resolve(response(shape, "old"));
    await oldWork;
    const joined = loadSessionTurnBodyIntoStore(args);
    expect(ports.read).toHaveBeenCalledTimes(2);
    fresh.resolve(response(shape, "fresh"));
    await Promise.all([freshWork, joined]);
    expect(ports.merge).toHaveBeenCalledTimes(1);
    expect(ports.merge).toHaveBeenCalledWith([{ id: "fresh" }], args.sessionId);
  });
  it("keeps empty bodies retryable", async () => {
    ports.read.mockResolvedValue(response(shape, null));
    await loadSessionTurnBodyIntoStore(args);
    expect(isTurnBodyLoaded(args.sessionId, args.turnId)).toBe(false);
    ports.read.mockResolvedValue(response(shape, "retry"));
    await loadSessionTurnBodyIntoStore(args);
    expect(isTurnBodyLoaded(args.sessionId, args.turnId)).toBe(true);
  });
  it("surfaces failure and allows a successful retry", async () => {
    ports.read.mockRejectedValueOnce(new Error("read failed"));
    await expect(loadSessionTurnBodyIntoStore(args)).rejects.toThrow(
      "read failed"
    );
    ports.read.mockResolvedValue(response(shape, "retry"));
    await loadSessionTurnBodyIntoStore(args);
    expect(isTurnBodyLoaded(args.sessionId, args.turnId)).toBe(true);
  });
  it("does not deliver an old failure into a replacement lifecycle", async () => {
    const read = deferred<unknown>();
    ports.read.mockReturnValue(read.promise);
    const work = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.read).toHaveBeenCalledTimes(1));
    clearLoadedTurnRegistry(args.sessionId);
    read.reject(new Error("old read failed"));
    await expect(work).resolves.toBeUndefined();
    expect(ports.merge).not.toHaveBeenCalled();
  });
});

it.each(cases.filter(([, shape]) => shape === "window" || shape === "batch"))(
  "%s rejects a result invalidated during Rust parsing",
  async (prefix, shape) => {
    const args = { sessionId: `${prefix}-owner-test`, turnId: "turn" };
    ports.read.mockResolvedValue(response(shape, "old"));
    const parsed = deferred<unknown[]>();
    ports.parse.mockReturnValue(parsed.promise);
    const work = loadSessionTurnBodyIntoStore(args);
    await vi.waitFor(() => expect(ports.parse).toHaveBeenCalledTimes(1));
    clearLoadedTurnRegistry(args.sessionId);
    parsed.resolve([{ id: "old" }]);
    await work;
    expect(ports.merge).not.toHaveBeenCalled();
  }
);
