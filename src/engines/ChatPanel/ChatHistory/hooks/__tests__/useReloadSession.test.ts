import { beforeEach, describe, expect, it, vi } from "vitest";

import { useReloadSession } from "../useReloadSession";

const mocks = vi.hoisted(() => ({
  activeId: "session-a",
  evict: vi.fn(),
  clear: vi.fn(),
  fail: vi.fn(),
  status: vi.fn(),
  reload: vi.fn(),
  select: vi.fn(),
}));
vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("@src/engines/SessionCore", () => ({
  clearSessionLoadErrorAtom: "clear",
  failSessionLoadAtom: "fail",
  loadStatusAtom: "status",
  triggerSessionReloadAtom: "reload",
}));
vi.mock("@src/store/session", () => ({ activeSessionIdAtom: "select" }));
vi.mock("jotai", () => ({
  useStore: () => ({ get: () => mocks.activeId }),
  useSetAtom: (key: "clear" | "fail" | "status" | "reload" | "select") =>
    mocks[key],
}));
vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { evictSession: mocks.evict },
}));

describe("useReloadSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeId = "session-a";
  });

  it("waits for eviction before starting the replacement load", async () => {
    let finish!: () => void;
    mocks.evict.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    expect(useReloadSession("session-a")()).toBeUndefined();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
    finish();
    await Promise.resolve();
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(mocks.reload).toHaveBeenCalledWith("session-a");
    expect(mocks.status).toHaveBeenCalledWith("loading");
  });

  it("does not switch back when eviction completes after navigation", async () => {
    let finish!: () => void;
    mocks.evict.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    expect(useReloadSession("session-a")()).toBeUndefined();
    mocks.activeId = "session-b";
    finish();
    await Promise.resolve();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("reports eviction failure without racing a reload against stale data", async () => {
    mocks.evict.mockRejectedValue(new Error("eviction failed"));
    useReloadSession("session-a")();
    await Promise.resolve();
    await vi.waitFor(() =>
      expect(mocks.fail).toHaveBeenCalledWith("eviction failed")
    );
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});
