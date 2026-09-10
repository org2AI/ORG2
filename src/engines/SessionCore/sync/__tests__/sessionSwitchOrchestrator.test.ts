import { beforeEach, describe, expect, it, vi } from "vitest";

import { runSessionSwitchOrchestrator } from "../sessionSwitchOrchestrator";
import type { SessionAdapter } from "../types";

const mocks = vi.hoisted(() => ({
  revision: vi.fn(),
  applyPostLoadResult: vi.fn(),
  capturePostLoadLifecycleSnapshot: vi.fn(() => ({
    lastTerminal: null,
    generation: 0,
  })),
  dispatchLoadSession: vi.fn(),
  getEvents: vi.fn(),
  hydrateSessionStoreBeforeDisplay: vi.fn(),
  isCollaborationImportedSession: vi.fn(() => false),
  loadInitialTurnWindow: vi.fn(),
  loadPersistedHistory: vi.fn(),
  messageError: vi.fn(),
  reconcileInFlightHistory: vi.fn(),
  rehydratePendingPlanApproval: vi.fn(),
  switchSession: vi.fn(),
}));

vi.mock("../nativeConversationRevision", () => ({
  loadNativeConversationRevision: mocks.revision,
}));

vi.mock("@src/components/Message", () => ({
  Message: { error: mocks.messageError },
}));

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    getEvents: mocks.getEvents,
    loadInitialTurnWindow: mocks.loadInitialTurnWindow,
    switchSession: mocks.switchSession,
  },
}));

vi.mock("@src/engines/SessionCore/ingestion/visibilityFilters", () => ({
  isVisibleInChat: () => true,
}));

vi.mock("@src/util/session/sessionDispatch", () => ({
  composerIdFromSessionId: () => null,
  isCollaborationImportedSession: mocks.isCollaborationImportedSession,
  isImportedHistorySession: () => false,
}));

vi.mock("../sessionSyncDerivedState", () => ({
  isCursorIdeSessionId: () => false,
}));

vi.mock("../sessionSyncPlanApproval", () => ({
  rehydratePendingPlanApproval: mocks.rehydratePendingPlanApproval,
}));

vi.mock("../sessionSyncReconcile", () => ({
  reconcileInFlightHistory: mocks.reconcileInFlightHistory,
}));

vi.mock("../sessionSyncStateHelpers", () => ({
  applyPostLoadResult: mocks.applyPostLoadResult,
  capturePostLoadLifecycleSnapshot: mocks.capturePostLoadLifecycleSnapshot,
  isPostLoadRunStatusSuperseded: vi.fn(() => false),
}));

vi.mock("../sessionSyncUtils", () => ({
  hydrateSessionStoreBeforeDisplay: mocks.hydrateSessionStoreBeforeDisplay,
  isInFlightRunStatus: (status: string | undefined) =>
    status === "running" ||
    status === "waiting_for_user" ||
    status === "waiting_for_funds",
  loadPersistedHistory: mocks.loadPersistedHistory,
}));

function createActions() {
  return {
    dispatchLoadSession: mocks.dispatchLoadSession,
    failSessionLoad: vi.fn(),
    setEvents: vi.fn(),
    setLoadStatus: vi.fn(),
    setSessionContextTokens: vi.fn(),
    setSessionContextUsage: vi.fn(),
    setSessionRuntimeError: vi.fn(),
    setSessionRuntimeStatus: vi.fn(),
    setWpReadOnly: vi.fn(),
  };
}

describe("runSessionSwitchOrchestrator reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revision.mockReset().mockResolvedValue("v1");
    mocks.isCollaborationImportedSession.mockReturnValue(false);
    mocks.switchSession.mockResolvedValue(true);
    mocks.getEvents.mockResolvedValue([{ id: "visible" }]);
  });

  it.each(["stable", "changed", "aborted"])(
    "hands off only a published stable cold load (%s)",
    async (state) => {
      mocks.switchSession.mockResolvedValue(false);
      mocks.loadPersistedHistory.mockResolvedValue([{ id: "native-history" }]);
      const controller = new AbortController();
      if (state === "changed")
        mocks.revision.mockResolvedValueOnce("v1").mockResolvedValue("v2");
      mocks.hydrateSessionStoreBeforeDisplay.mockImplementationOnce(
        async () => {
          expect(mocks.dispatchLoadSession).not.toHaveBeenCalled();
          if (state === "aborted") controller.abort();
        }
      );
      const actions = createActions();
      runSessionSwitchOrchestrator({
        sessionId: "cli-cold-load",
        adapter: {
          category: "cli",
          postLoad: vi.fn().mockResolvedValue({ runStatus: "idle" }),
        } as unknown as SessionAdapter,
        abortController: controller,
        refs: { liveSessionIdRef: { current: "cli-cold-load" } },
        actions,
        setPendingPlanApprovals: vi.fn(),
        logger: { error: vi.fn() } as never,
      });
      await vi.waitFor(() =>
        expect(mocks.hydrateSessionStoreBeforeDisplay).toHaveBeenCalledOnce()
      );
      if (state === "aborted") {
        expect(mocks.dispatchLoadSession).not.toHaveBeenCalled();
      } else {
        expect(mocks.dispatchLoadSession).toHaveBeenCalledWith(
          expect.objectContaining({
            storeHydrated: true,
            nativeHistoryRevision:
              state === "stable"
                ? { revision: "v1", generation: 0 }
                : undefined,
          })
        );
      }
      expect(actions.failSessionLoad).not.toHaveBeenCalled();
    }
  );

  it("uses the complete persisted projection on an imported-session cache hit", async () => {
    const sessionId = "imported-session-retry";
    const events = [{ id: "history" }, { id: "failed-delivery" }];
    mocks.isCollaborationImportedSession.mockReturnValue(true);
    mocks.loadPersistedHistory.mockResolvedValue(events);
    const adapter = {
      category: "agent",
      postLoad: vi.fn().mockResolvedValue({ runStatus: "idle" }),
    } as unknown as SessionAdapter;
    runSessionSwitchOrchestrator({
      sessionId,
      adapter,
      abortController: new AbortController(),
      refs: { liveSessionIdRef: { current: sessionId } },
      actions: createActions(),
      setPendingPlanApprovals: vi.fn(),
      logger: { error: vi.fn() } as never,
    });

    await vi.waitFor(() =>
      expect(mocks.dispatchLoadSession).toHaveBeenCalledOnce()
    );
    expect(mocks.loadPersistedHistory).toHaveBeenCalledWith(
      adapter,
      sessionId,
      expect.any(AbortSignal)
    );
    expect(mocks.hydrateSessionStoreBeforeDisplay).toHaveBeenCalledWith(
      sessionId,
      events
    );
    expect(mocks.dispatchLoadSession).toHaveBeenCalledWith(
      expect.objectContaining({ events })
    );
    expect(mocks.loadInitialTurnWindow).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, false],
    ["idle", false],
    ["completed", false],
    ["running", true],
    ["waiting_for_user", true],
    ["waiting_for_funds", true],
  ] as const)(
    "reconciles only an in-flight session (status=%s)",
    async (runStatus, shouldReconcile) => {
      const adapter = {
        category: "cli",
        loadHistory: vi.fn(),
        postLoad: vi
          .fn()
          .mockResolvedValue(runStatus === undefined ? {} : { runStatus }),
      } as unknown as SessionAdapter;

      runSessionSwitchOrchestrator({
        sessionId: "cli-session",
        adapter,
        abortController: new AbortController(),
        refs: { liveSessionIdRef: { current: "cli-session" } },
        actions: createActions(),
        setPendingPlanApprovals: vi.fn(),
        logger: { error: vi.fn() } as never,
      });

      await vi.waitFor(() => {
        expect(mocks.dispatchLoadSession).toHaveBeenCalledOnce();
      });
      expect(mocks.reconcileInFlightHistory).toHaveBeenCalledTimes(
        shouldReconcile ? 1 : 0
      );
    }
  );
});
