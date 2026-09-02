import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import {
  type ConversationRootLocator,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  type ActiveMessageDelivery,
  messageDeliveryRecordsAtom,
} from "@src/store/ui/messageQueueAtom";

import {
  conversationActiveDeliveriesAtom,
  reconcileHydratedLocalChildState,
  resolveConversationRunnerBindings,
  retainHydratedLocalChildEvents,
} from "./ConversationStreamProvider";

function root(conversationId: string): ConversationRootLocator {
  return {
    authority: "org2-cloud",
    authorityScope: ["https://cloud.example", "org-1"],
    conversationId,
  };
}

function activeDelivery(
  id: string,
  conversationId: string,
  dispatchIdentityKey = "identity-a"
): ActiveMessageDelivery {
  return {
    id,
    turnIntentId: `turn-${id}`,
    sessionId: conversationId,
    content: id,
    displayContent: id,
    conversationDispatch: {
      kind: "canonical_conversation",
      root: root(conversationId),
      target: { cliAgentType: "claude_code" },
      dispatchIdentityKey,
    },
    status: "preparing",
    priority: "next",
    createdAt: "2026-09-04T00:00:00.000Z",
  };
}

describe("resolveConversationRunnerBindings", () => {
  it("keeps the visible transcript on its canonical source while footer and Stop follow the runner", () => {
    expect(
      resolveConversationRunnerBindings(
        "codexapp-canonical-source",
        "cliagent-native-runner"
      )
    ).toEqual({
      sourceSessionId: "codexapp-canonical-source",
      controlSessionId: "cliagent-native-runner",
      planningIndicatorScope: {
        sessionId: "cliagent-native-runner",
        isLive: true,
      },
    });
  });

  it("returns footer and Stop to their ordinary source owners without a runner", () => {
    expect(
      resolveConversationRunnerBindings("cliagent-ordinary", null)
    ).toEqual({
      sourceSessionId: "cliagent-ordinary",
      controlSessionId: null,
      planningIndicatorScope: null,
    });
  });
});

describe("conversation delivery lifecycle scoping", () => {
  it("does not notify one conversation when an unrelated delivery changes", () => {
    const store = createStore();
    const matching = activeDelivery("matching", "root-a");
    const unrelated = activeDelivery("unrelated", "root-b");
    const scopedAtom = conversationActiveDeliveriesAtom({
      cloudRootKey: conversationRootKey(root("root-a")),
      cloudIdentityKey: "identity-a",
      localRootKey: null,
    });
    const listener = vi.fn();
    const unsubscribe = store.sub(scopedAtom, listener);

    store.set(messageDeliveryRecordsAtom, [matching]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get(scopedAtom)).toEqual([matching]);

    store.set(messageDeliveryRecordsAtom, [matching, unrelated]);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(messageDeliveryRecordsAtom, [matching, { ...unrelated }]);
    expect(listener).toHaveBeenCalledTimes(1);

    store.set(messageDeliveryRecordsAtom, [{ ...matching }, unrelated]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("keeps Cloud delivery identity isolation while local roots use their root owner", () => {
    const matching = activeDelivery("matching", "root-a", "identity-a");
    const wrongIdentity = activeDelivery(
      "wrong-identity",
      "root-a",
      "identity-b"
    );
    const local = activeDelivery("local", "local-root", "identity-b");
    const store = createStore();
    const scopedAtom = conversationActiveDeliveriesAtom({
      cloudRootKey: conversationRootKey(root("root-a")),
      cloudIdentityKey: "identity-a",
      localRootKey: conversationRootKey(root("local-root")),
    });
    store.set(messageDeliveryRecordsAtom, [matching, wrongIdentity, local]);

    expect(store.get(scopedAtom)).toEqual([matching, local]);
  });
});

describe("local execution-child hydration lifecycle", () => {
  const childAEvents = [{ id: "event-a" }] as unknown as SessionEvent[];
  const childBEvents = [{ id: "event-b" }] as unknown as SessionEvent[];

  it("prunes children that no longer belong to the current root", () => {
    const previous = new Map<string, readonly SessionEvent[]>([
      ["child-a", childAEvents],
      ["child-b", childBEvents],
    ]);

    const retained = retainHydratedLocalChildEvents(
      previous,
      new Set(["child-b"])
    );
    expect([...retained]).toEqual([["child-b", childBEvents]]);
    expect(retainHydratedLocalChildEvents(retained, new Set(["child-b"]))).toBe(
      retained
    );
  });

  it("clears retained events on a root switch even if a child id is reused", () => {
    const previous = {
      rootKey: "root-a",
      events: new Map<string, readonly SessionEvent[]>([
        ["child-a", childAEvents],
      ]),
    };

    const next = reconcileHydratedLocalChildState(
      previous,
      "root-b",
      new Set(["child-a"])
    );
    expect(next.rootKey).toBe("root-b");
    expect(next.events.size).toBe(0);
  });
});
