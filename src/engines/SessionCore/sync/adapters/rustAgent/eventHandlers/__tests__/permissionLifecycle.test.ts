import { beforeEach, describe, expect, it, vi } from "vitest";

import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import {
  getPendingPermissionRequests,
  pendingPermissionRequestsAtom,
} from "@src/store/session/permissionRequestAtom";
import {
  createInstrumentedStore,
  getInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import type { AgentWSEvent } from "../../../shared/types";
import { handlePermissionRequest } from "../agentSpecific";
import { handleInteractionFinalized } from "../toolHandlers";
import type { EventHandlerContext } from "../types";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: { mergeEvents: vi.fn().mockResolvedValue(undefined) },
}));

beforeEach(() => {
  resetInstrumentedStore();
  createInstrumentedStore();
  vi.clearAllMocks();
});
describe("permission lifecycle at the Rust event boundary", () => {
  it.each([false, true])(
    "finalizes an unmounted card even when transcript persistence fails (%s)",
    async (fails) => {
      const store = getInstrumentedStore();
      const ctx = { getDefaultStore: () => store } as EventHandlerContext;
      handlePermissionRequest(
        {
          type: "permission:request",
          sessionId: "s1",
          requestId: "request-1",
          toolCallId: "call-1",
          tool: "bash",
        } as AgentWSEvent,
        "s1",
        ctx
      );
      expect(
        getPendingPermissionRequests(
          store.get(pendingPermissionRequestsAtom),
          "s1"
        )
      ).toHaveLength(1);
      if (fails)
        vi.mocked(eventStoreProxy.mergeEvents).mockRejectedValueOnce(
          new Error("offline")
        );
      const result = handleInteractionFinalized(
        {
          type: "agent:interaction_finalized",
          sessionId: "s1",
          tool: "permission",
          toolCallId: "call-1",
          resultObject: { status: "approved" },
        } as AgentWSEvent,
        "s1"
      );
      if (fails) await expect(result).rejects.toThrow("offline");
      else await result;
      expect(store.get(pendingPermissionRequestsAtom).size).toBe(0);
    }
  );
});
