// @vitest-environment jsdom
import nativeFixture from "@/src-tauri/crates/orgtrack-core/src/sources/fixtures/codex_native_failed_user.json";
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { isRetryableFailedUserIntentHeader } from "@src/engines/ChatPanel/ChatHistory/hooks/useGroupHeaderRenderer";
import { projectChatHistory } from "@src/engines/ChatPanel/ChatHistory/projection/core";
import UserChatItem from "@src/engines/ChatPanel/ChatItems/UserChatItem";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  type QueuedMessage,
  messageQueueAtom,
} from "@src/store/ui/messageQueueAtom";
import { useTestTranslation } from "@src/test/i18nTestTranslate";

import {
  chatEventsForSessionAtomFamily,
  sessionSnapshotAtomFamily,
} from "../sessionScopedChatEvents";

vi.mock("react-i18next", () => ({
  useTranslation: (...args: Parameters<typeof useTestTranslation>) =>
    useTestTranslation(...args),
}));

const sessionId = "cliagent-native-retry-fixture";
// normalize_history verifies this shared wire shape after parsing and Rust
// ingestion. Raw user_message becomes canonical functionName/uiCanonical user.
const user = {
  ...nativeFixture.normalizedUser,
  chunk_id: nativeFixture.normalizedUser.id,
  sessionId,
  createdAt: "2026-09-18T16:00:49.099Z",
  args: {},
  activityStatus: "agent",
} as SessionEvent;
const owner: QueuedMessage = {
  id: "queue-outage",
  turnIntentId: nativeFixture.user.result.turnIntentId,
  sessionId,
  content: user.displayText,
  displayContent: user.displayText,
  createdAt: "2026-09-18T16:00:48.546Z",
  status: "queued",
  priority: "next",
  requiresExplicitDispatch: true,
  deliveryError: "Agent request failed",
};

function hydrate(
  events: SessionEvent[],
  queued: QueuedMessage[] = [owner],
  store = createStore()
) {
  store.set(sessionSnapshotAtomFamily(sessionId), {
    loadStarted: true,
    snapshot: {
      version: 1,
      eventCount: events.length,
      events,
      chatEvents: events,
      messagesEvents: events,
      sortedSimulatorEvents: [],
      lastEvent: events.at(-1) ?? null,
      eventIndex: Object.fromEntries(
        events.map((event, index) => [event.id, index])
      ),
      chatEventCount: events.length,
      hasRunningEvent: false,
      streaming: false,
    },
  });
  store.set(messageQueueAtom, queued);
  return store;
}

describe("native failed turn durable owner to rendered Retry", () => {
  it("projects the real native user on session hydration and renders an enabled Retry for the same queue owner", async () => {
    expect(user.result.backendPersisted).toBeUndefined();
    const original = structuredClone(user);
    const store = hydrate([]);
    expect(
      store.get(chatEventsForSessionAtomFamily(sessionId))[0].result
    ).toMatchObject({ deliveryStatus: "failed", queueMessageId: owner.id });
    // Reproduce startup fallback → hydrated A/B/C on the same subscription.
    const priorTurns = ["A", "B"].flatMap((intent, index) => [
      {
        ...user,
        id: `user-${intent}`,
        createdAt: `2026-09-18T15:59:0${index}.000Z`,
        result: { ...user.result, turnIntentId: intent },
      },
      {
        ...user,
        id: `assistant-${intent}`,
        source: "assistant" as const,
        actionType: "assistant",
        functionName: "assistant",
        uiCanonical: "agent_message",
        createdAt: `2026-09-18T15:59:0${index}.001Z`,
        displayText: "previous reply",
        result: { observation: "previous reply", turnIntentId: intent },
      },
    ]);
    hydrate([...priorTurns, user], [owner], store);
    const projected = store.get(chatEventsForSessionAtomFamily(sessionId));
    expect(projected).toHaveLength(5);
    expect(projected[4]).toMatchObject({
      source: "user",
      displayStatus: "failed",
      result: {
        queueMessageId: owner.id,
        turnIntentId: owner.turnIntentId,
        deliveryStatus: "failed",
        syntheticUserInput: true,
      },
    });
    const history = projectChatHistory(projected, {
      groups: { defaultTurnCollapsed: true },
    });
    const header = history.groups!.groupHeaders.at(-1)!;
    expect(isRetryableFailedUserIntentHeader(header)).toBe(true);
    const retry = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    // jsdom has no layout observer; the real bubble now measures its fold.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    try {
      await act(async () =>
        root.render(
          createElement(
            Provider,
            { store },
            createElement(UserChatItem, {
              chatItem: header,
              onEditSubmit: retry,
            })
          )
        )
      );
      const notice = container.querySelector(
        '[data-testid="chat-message-delivery-failed"]'
      );
      expect(notice).not.toBeNull();
      const button = Array.from(notice!.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === "Retry"
      );
      expect(button).toBeDefined();
      expect(button!.disabled).toBe(false);
      await act(async () => button!.click());
      expect(retry).toHaveBeenCalledWith(owner.displayContent, undefined);
      expect(store.get(messageQueueAtom)).toEqual([owner]);
      expect(user).toEqual(original);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it("preserves an explicit sent row and a matching-intent row from another session", () => {
    const sent = {
      ...user,
      result: { ...user.result, deliveryStatus: "sent" },
    };
    expect(
      hydrate([sent]).get(chatEventsForSessionAtomFamily(sessionId))
    ).toEqual([sent]);
    const foreign = { ...user, sessionId: "another-session" };
    const projected = hydrate([foreign]).get(
      chatEventsForSessionAtomFamily(sessionId)
    );
    expect(projected[0]).toBe(foreign);
    expect(projected[1].result.queueMessageId).toBe(owner.id);
  });

  it("does not let a correlated non-user row steal the owner or overwrite partial/tool/private output", () => {
    const outputs = ["assistant", "tool_call", "thinking"].map(
      (actionType) => ({
        ...user,
        id: actionType,
        actionType,
        functionName: actionType,
        source: "assistant" as const,
        displayText: "real output",
        result: { turnIntentId: owner.turnIntentId },
      })
    );
    const projected = hydrate([...outputs, user]).get(
      chatEventsForSessionAtomFamily(sessionId)
    );
    expect(projected.slice(0, 3)).toEqual(outputs);
    expect(projected[3].result.queueMessageId).toBe(owner.id);
  });
});
