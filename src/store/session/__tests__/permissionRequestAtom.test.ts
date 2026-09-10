import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import type { PermissionRequestEvent } from "@src/engines/SessionCore/sync/adapters/shared";

import {
  pendingPermissionRequestsAtom,
  permissionRequestsForSessionAtomFamily,
} from "../permissionRequestAtom";
import {
  type PendingPermissionRequestMap,
  clearFinalizedPermissionRequest,
  clearPendingPermissionRequest,
  getPendingPermissionRequests,
  upsertPendingPermissionRequest,
} from "../permissionRequestAtom";

function request(
  requestId: string,
  sessionId = "session-1"
): PermissionRequestEvent {
  return {
    requestId,
    sessionId,
    tool: "edit_file",
    args: { path: "src/app.ts" },
  };
}

describe("permissionRequestAtom helpers", () => {
  it("keeps independent ordered queues per session", () => {
    let state: PendingPermissionRequestMap = new Map();
    state = upsertPendingPermissionRequest(state, request("r1"));
    state = upsertPendingPermissionRequest(state, request("r2"));
    state = upsertPendingPermissionRequest(
      state,
      request("other", "session-2")
    );

    expect(
      getPendingPermissionRequests(state, "session-1").map(
        (item) => item.requestId
      )
    ).toEqual(["r1", "r2"]);
    expect(getPendingPermissionRequests(state, "session-2")[0]?.requestId).toBe(
      "other"
    );
  });

  it("clears only the matching session and request", () => {
    let state: PendingPermissionRequestMap = new Map();
    state = upsertPendingPermissionRequest(state, request("r1"));
    state = upsertPendingPermissionRequest(state, request("r2"));
    state = clearPendingPermissionRequest(state, "session-1", "r1");

    expect(getPendingPermissionRequests(state, "session-1")[0]?.requestId).toBe(
      "r2"
    );
  });

  it("clears a finalized request by tool-call identity", () => {
    let state: PendingPermissionRequestMap = new Map();
    state = upsertPendingPermissionRequest(state, {
      ...request("r1"),
      toolCallId: "call-1",
    });
    state = clearFinalizedPermissionRequest(state, "session-1", {
      toolCallId: "call-1",
    });

    expect(getPendingPermissionRequests(state, "session-1")).toEqual([]);
  });
  it("does not notify a session view about another session's requests", () => {
    const store = createStore();
    const scoped = permissionRequestsForSessionAtomFamily("session-1");
    let notifications = 0;
    const stop = store.sub(scoped, () => {
      notifications++;
    });
    store.set(pendingPermissionRequestsAtom, (prev) =>
      upsertPendingPermissionRequest(prev, request("r2", "session-2"))
    );
    expect(notifications).toBe(0);
    stop();
  });

  it("does not use the tool call fallback when an explicit request ID differs", () => {
    const pending = { ...request("new"), toolCallId: "same-tool" };
    const state = upsertPendingPermissionRequest(new Map(), pending);
    expect(
      clearFinalizedPermissionRequest(state, "session-1", {
        requestId: "old",
        toolCallId: "same-tool",
      })
    ).toBe(state);
  });
});
