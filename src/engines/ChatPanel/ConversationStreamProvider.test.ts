import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import {
  type ConversationRootLocator,
  conversationRootKey,
} from "@src/engines/SessionCore/conversations/conversationTypes";
import * as localHistory from "@src/engines/SessionCore/conversations/localConversationExecutionTail";
import {
  NATIVE_SOURCE_EVENT_ID_ARG,
  nativeSourceEventId,
} from "@src/engines/SessionCore/conversations/nativeConversationMaterializer";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isVisibleInChat } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import { buildConversationRunnerOverlay } from "@src/features/Org2Cloud/SessionConversation/conversationRunnerOverlay";
import {
  type ActiveMessageDelivery,
  messageDeliveryRecordsAtom,
} from "@src/store/ui/messageQueueAtom";

import {
  assembleConversationWithLocalExecution,
  conversationActiveDeliveriesAtom,
  createLocalExecutionHydrationCoordinator,
  hydrateLocalExecutionSnapshot,
  localExecutionRootForSession,
  projectVisibleLocalExecutionTail,
  resolveConversationRunnerBindings,
  selectConversationActiveRunners,
  shouldHydrateLocalExecutionSnapshot,
  shouldIngestConversationRunnerLiveEvents,
} from "./ConversationStreamProvider";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function messageEvent(
  id: string,
  source: "user" | "assistant",
  displayText: string,
  createdAt: string
): SessionEvent {
  return {
    id,
    chunk_id: id,
    sessionId: "root",
    createdAt,
    functionName: source === "user" ? "user_message" : "assistant_message",
    uiCanonical: source === "user" ? "user" : "assistant_message",
    actionType: source === "user" ? "raw" : "assistant",
    args: {},
    result: { content: displayText },
    source,
    displayText,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    payloadRefs: [],
  } as SessionEvent;
}

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
  it("retains native execution authority for an owned session with cloud comments", () => {
    const session = {
      session_id: "cliagent-owned",
      cliAgentType: "claude_code",
      orgId: "cloud:team",
    } as Parameters<typeof localExecutionRootForSession>[1];
    expect(
      localExecutionRootForSession("cliagent-owned", session, false)
    ).toEqual({
      authority: "local-session",
      authorityScope: [],
      conversationId: "cliagent-owned",
    });
    expect(
      localExecutionRootForSession("cliagent-owned", session, true)
    ).toBeNull();
    expect(
      localExecutionRootForSession("imported-session-remote", undefined, false)
    ).toBeNull();
  });
  it("rehydrates a settled child projection after native refresh, but not during delivery", () => {
    const before = { rootKey: "root", activeDeliveryCount: 0, refreshEpoch: 1 };
    expect(
      shouldHydrateLocalExecutionSnapshot(before, {
        ...before,
        refreshEpoch: 2,
      })
    ).toBe(true);
    expect(
      shouldHydrateLocalExecutionSnapshot(before, {
        ...before,
        activeDeliveryCount: 1,
        refreshEpoch: 2,
      })
    ).toBe(false);
    expect(shouldHydrateLocalExecutionSnapshot(before, before)).toBe(false);
  });
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

describe("shouldIngestConversationRunnerLiveEvents", () => {
  it("mounts the hidden runner ingestion edge for a canonical root", () => {
    expect(
      shouldIngestConversationRunnerLiveEvents(
        "cliagent-hidden",
        "imported-session-root"
      )
    ).toBe(true);
  });

  it("leaves a visible runner to the primary SessionSync owner", () => {
    expect(
      shouldIngestConversationRunnerLiveEvents(
        "cliagent-visible",
        "cliagent-visible"
      )
    ).toBe(false);
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
  it("hydrates only on first/root-change/settled-delivery boundaries", () => {
    expect(
      shouldHydrateLocalExecutionSnapshot(null, {
        rootKey: "root-a",
        activeDeliveryCount: 0,
      })
    ).toBe(true);
    expect(
      shouldHydrateLocalExecutionSnapshot(
        { rootKey: "root-a", activeDeliveryCount: 0 },
        { rootKey: "root-a", activeDeliveryCount: 1 }
      )
    ).toBe(false);
    expect(
      shouldHydrateLocalExecutionSnapshot(
        { rootKey: "root-a", activeDeliveryCount: 1 },
        { rootKey: "root-a", activeDeliveryCount: 0 }
      )
    ).toBe(true);
    expect(
      shouldHydrateLocalExecutionSnapshot(
        { rootKey: "root-a", activeDeliveryCount: 0 },
        { rootKey: "root-b", activeDeliveryCount: 0 }
      )
    ).toBe(true);
    expect(
      shouldHydrateLocalExecutionSnapshot(
        { rootKey: "root-a", activeDeliveryCount: 0 },
        { rootKey: null, activeDeliveryCount: 0 }
      )
    ).toBe(false);
  });

  it("single-flights hydration bursts and commits only the latest generation", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const loads: string[] = [];
    const commits: Array<[string, string]> = [];
    const coordinator = createLocalExecutionHydrationCoordinator(
      async (request: string) => {
        loads.push(request);
        return loads.length === 1 ? first.promise : second.promise;
      },
      (result, request) => commits.push([result, request]),
      () => undefined
    );

    coordinator.request("old-root");
    coordinator.request("latest-root");
    expect(loads).toEqual(["old-root"]);

    first.resolve("stale-result");
    await first.promise;
    await vi.waitFor(() => {
      expect(loads).toEqual(["old-root", "latest-root"]);
    });
    expect(commits).toEqual([]);

    second.resolve("latest-result");
    await second.promise;
    await vi.waitFor(() => {
      expect(commits).toEqual([["latest-result", "latest-root"]]);
    });
  });

  it("releases hydration ownership if an error callback throws", async () => {
    const hydrate = vi.fn(async (request: string) => {
      if (request === "failed-root") throw new Error("read failed");
      return request;
    });
    const commit = vi.fn();
    const coordinator = createLocalExecutionHydrationCoordinator(
      hydrate,
      commit,
      () => {
        coordinator.request("next-root");
        throw new Error("error subscriber failed");
      }
    );

    coordinator.request("failed-root");
    await vi.waitFor(() => {
      expect(commit).toHaveBeenCalledWith("next-root", "next-root");
    });
    coordinator.request("later-root");
    await vi.waitFor(() => {
      expect(commit).toHaveBeenCalledWith("later-root", "later-root");
    });
    expect(hydrate).toHaveBeenCalledTimes(3);
  });

  it("routes a local active turn through the same runner overlay as Cloud", () => {
    const delivery = {
      ...activeDelivery("local-turn", "local-root"),
      runnerSessionId: "claude-child",
      // Raw provider history contains many rows hidden from chat projection.
      runnerEventStartIndex: 36,
    };
    const [runner] = selectConversationActiveRunners([delivery], {
      cloudRootKey: null,
      cloudIdentityKey: null,
      localRootKey: conversationRootKey(root("local-root")),
      landedTurnIds: new Set(),
    });
    const historical = messageEvent(
      "historical",
      "assistant",
      "old answer",
      "2026-09-05T00:00:00Z"
    );
    const currentUser = messageEvent(
      "current-user",
      "user",
      "continue",
      "2026-09-05T00:01:00Z"
    );
    const currentAssistant = messageEvent(
      "current-assistant",
      "assistant",
      "working",
      "2026-09-05T00:01:01Z"
    );

    expect(runner).toEqual({
      runnerSessionId: "claude-child",
      turnId: "turn-local-turn",
      eventStartIndex: 36,
    });
    if (!runner) throw new Error("expected local active runner");
    expect(
      buildConversationRunnerOverlay(
        runner,
        [
          historical,
          {
            ...currentUser,
            result: {
              ...currentUser.result,
              turnIntentId: "turn-local-turn",
            },
          },
          {
            ...historical,
            id: "materialized-historical",
            chunk_id: "materialized-historical",
            args: {
              [NATIVE_SOURCE_EVENT_ID_ARG]: nativeSourceEventId(historical),
            },
          },
          {
            ...currentAssistant,
            result: {
              ...currentAssistant.result,
              turnIntentId: "turn-local-turn",
            },
          },
        ],
        "local-root"
      ).map((event) => [event.id, event.displayText])
    ).toEqual([["runlive-current-assistant", "working"]]);
  });

  it("verifies a child against raw native history before applying chat visibility", () => {
    const rawRoot = [
      messageEvent("root-user", "user", "inspect", "2026-09-05T00:00:00Z"),
      // Normal chat projection hides this structural native message, but it
      // still participates in the provider transcript prefix.
      messageEvent("root-hidden", "assistant", "   ", "2026-09-05T00:00:01Z"),
      messageEvent("root-answer", "assistant", "done", "2026-09-05T00:00:02Z"),
    ];
    const suffix = [
      messageEvent("child-user", "user", "continue", "2026-09-05T00:01:00Z"),
      messageEvent(
        "child-answer",
        "assistant",
        "continued",
        "2026-09-05T00:01:01Z"
      ),
    ];
    const childEvents = [
      ...rawRoot.map((event) => ({
        ...event,
        id: `child-${event.id}`,
        chunk_id: `child-${event.id}`,
      })),
      ...suffix,
    ];
    const child = {
      session_id: "claude-child",
      created_at: "2026-09-05T00:01:00Z",
    };

    expect(rawRoot.filter(isVisibleInChat)).toHaveLength(2);
    expect(
      projectVisibleLocalExecutionTail(
        rawRoot.filter(isVisibleInChat),
        [{ child, events: childEvents }],
        "root"
      )
    ).toEqual([]);
    expect(
      projectVisibleLocalExecutionTail(
        rawRoot,
        [{ child, events: childEvents }],
        "root"
      ).map((event) => event.displayText)
    ).toEqual(["continue", "continued"]);
  });
});

describe("local execution history hydration", () => {
  it("does not read or retain the root transcript when there are no children", async () => {
    const children = vi
      .spyOn(localHistory, "loadLocalExecutionChildren")
      .mockResolvedValue([]);
    const canonical = vi.spyOn(
      localHistory,
      "loadLocalCanonicalConversationSnapshot"
    );
    try {
      expect(
        await hydrateLocalExecutionSnapshot({
          root: root("local"),
          rootKey: "local",
        })
      ).toEqual({ rootKey: "local", snapshot: null });
      expect(children).toHaveBeenCalledOnce();
      expect(canonical).not.toHaveBeenCalled();
    } finally {
      children.mockRestore();
      canonical.mockRestore();
    }
  });
});

describe("native child and cloud plane ownership", () => {
  it("merges a landed child through plane identity once while retaining external App turns", () => {
    const first = messageEvent(
      "root-answer",
      "assistant",
      "41",
      "2026-09-09T20:00:00Z"
    );
    const user = messageEvent(
      "child-user",
      "user",
      "add one",
      "2026-09-09T20:01:00Z"
    );
    user.result = { ...user.result, turnIntentId: "conversion-turn" };
    const answer = messageEvent(
      "child-answer",
      "assistant",
      "42",
      "2026-09-09T20:01:01Z"
    );
    const externalUser = messageEvent(
      "app-user",
      "user",
      "add one",
      "2026-09-09T20:02:00Z"
    );
    const externalAnswer = messageEvent(
      "app-answer",
      "assistant",
      "43",
      "2026-09-09T20:02:01Z"
    );
    const tails = [user, answer, externalUser, externalAnswer].map((event) => ({
      ...event,
      id: `runlanded-${event.id}`,
      args: { ...event.args, [NATIVE_SOURCE_EVENT_ID_ARG]: event.id },
    }));
    const result = assembleConversationWithLocalExecution(
      {
        family: null,
        anchorBareSessionId: "root",
        anchorEvents: [first],
        planeEvents: [user, answer].map((event, index) => ({
          id: `plane-${index}`,
          rootSessionId: "root",
          authorUserId: "self",
          turnId: "conversion-turn",
          seq: index + 1,
          event,
          createdAt: event.createdAt,
        })),
        comments: [],
        streamSessionId: "root",
        viewer: { status: "loading" },
      },
      tails
    );
    expect(result.map((event) => event.displayText)).toEqual([
      "41",
      "add one",
      "42",
      "add one",
      "43",
    ]);
  });
});
