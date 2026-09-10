import { describe, expect, it, vi } from "vitest";

import { getPendingPlanApproval } from "@src/api/tauri/agent";
import {
  type PlanApprovalStateMap,
  clearPendingPlanApproval,
  upsertPendingPlanApproval,
} from "@src/store/session/planApprovalAtom";

import { rehydratePendingPlanApproval } from "../sessionSyncPlanApproval";

vi.mock("@src/api/tauri/agent", () => ({
  getPendingPlanApproval: vi.fn(),
}));

const mockedGetPending = vi.mocked(getPendingPlanApproval);

function existingState(): PlanApprovalStateMap {
  return new Map([
    [
      "session-1",
      {
        current: {
          sessionId: "session-1",
          planPath: "/plan.md",
          planTitle: "Plan",
          planContent: "stale",
          planRevisionId: "rev-1",
        },
      },
    ],
  ]);
}

async function flushRehydrate(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("rehydratePendingPlanApproval", () => {
  it("clears stale frontend state when the backend reports no pending plan", async () => {
    mockedGetPending.mockResolvedValueOnce(null);
    let state = existingState();

    rehydratePendingPlanApproval(
      "session-1",
      new AbortController(),
      (update) => {
        state = update(state);
      }
    );
    await flushRehydrate();

    expect(state.get("session-1")?.current).toBeNull();
  });

  it("refreshes content for the same authoritative backend revision", async () => {
    mockedGetPending.mockResolvedValueOnce({
      sessionId: "session-1",
      planPath: "/plan.md",
      planTitle: "Plan",
      planContent: "fresh",
      planRevisionId: "rev-1",
    });
    let state = existingState();

    rehydratePendingPlanApproval(
      "session-1",
      new AbortController(),
      (update) => {
        state = update(state);
      }
    );
    await flushRehydrate();

    expect(state.get("session-1")?.current?.planContent).toBe("fresh");
  });

  it("replaces a stale local revision when no live mutation raced the fetch", async () => {
    mockedGetPending.mockResolvedValueOnce({
      sessionId: "session-1",
      planPath: "/plan.md",
      planTitle: "Plan",
      planContent: "current backend content",
      planRevisionId: "rev-2",
    });
    let state = existingState();

    rehydratePendingPlanApproval(
      "session-1",
      new AbortController(),
      (update) => {
        state = update(state);
      }
    );
    await flushRehydrate();

    expect(state.get("session-1")?.current?.planContent).toBe(
      "current backend content"
    );
  });
  it.each(["new plan", "save", "finalize"])(
    "ignores a late snapshot after %s",
    async (mutation) => {
      let resolve!: (
        value: Awaited<ReturnType<typeof getPendingPlanApproval>>
      ) => void;
      mockedGetPending.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        })
      );
      let state = existingState();
      const original = state.get("session-1")!.current!;
      rehydratePendingPlanApproval(
        "session-1",
        new AbortController(),
        (update) => {
          state = update(state);
        }
      );
      state =
        mutation === "finalize"
          ? clearPendingPlanApproval(state, "session-1")
          : upsertPendingPlanApproval(state, {
              ...original,
              planContent: "live edit",
              planRevisionId:
                mutation === "save" ? original.planRevisionId : "new-revision",
            });
      const live = state;
      resolve(mutation === "new plan" ? null : original);
      await flushRehydrate();
      expect(state).toBe(live);
    }
  );

  it("does not discard a snapshot for an unrelated session update", async () => {
    mockedGetPending.mockResolvedValueOnce(null);
    let state = existingState();
    rehydratePendingPlanApproval(
      "session-1",
      new AbortController(),
      (update) => {
        state = update(state);
      }
    );
    state = upsertPendingPlanApproval(state, {
      ...state.get("session-1")!.current!,
      sessionId: "other",
    });
    await flushRehydrate();
    expect(state.get("session-1")?.current).toBeNull();
    expect(state.get("other")?.current).toBeTruthy();
  });
});
