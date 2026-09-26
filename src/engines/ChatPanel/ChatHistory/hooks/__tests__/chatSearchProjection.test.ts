// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "../../chatItemPipeline/types";
import {
  CHAT_EVENT_IDS_ATTR,
  CHAT_FLAT_INDEX_ATTR,
  CHAT_ITEM_ID_ATTR,
  findChatSearchTargetElement,
  formatChatEventIdsAttribute,
} from "../chatSearch";
import {
  buildEventIdProjectionIndex,
  collectChatItemEventIds,
} from "../chatSearchProjection";
import { projectChatGroups } from "../useChatGroupsProjection";

function event(id: string): SessionEvent {
  return {
    chunk_id: id,
    id,
    sessionId: "session-1",
    createdAt: "2026-08-25T00:00:00.000Z",
    functionName: "glob_file_search",
    uiCanonical: "glob_file_search",
    actionType: "tool_call",
    args: {},
    result: {},
    source: "assistant",
    displayText: id,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
  };
}

function item(
  chunkId: string,
  extra: Partial<OptimizedChatItem> = {}
): OptimizedChatItem {
  return {
    chunk_id: chunkId,
    type: "activity",
    event: event(chunkId),
    ...extra,
  } as OptimizedChatItem;
}

describe("chatSearchProjection", () => {
  it("keeps exact ownership for collapsed events and empty turn headers", () => {
    const allItems = [item("user-a"), item("answer-a"), item("user-b")];
    const groups = projectChatGroups(allItems, {
      isTurnHeaderItem: (row) => row.chunk_id.startsWith("user-"),
      defaultTurnCollapsed: true,
      tailTurnPhase: "complete",
    });
    const index = buildEventIdProjectionIndex(
      groups.flatItems,
      groups.groupCounts,
      groups.groupMeta,
      allItems,
      groups.originalToFlatIndex,
      groups.groupHeaders
    );
    expect(index.get("user-a")).toMatchObject({
      groupIndex: 0,
      turnId: "user-a",
    });
    expect(index.get("user-b")).toMatchObject({
      groupIndex: 1,
      turnId: "user-b",
    });
  });
  it("collects nested activity stack event ids", () => {
    const stack = item("stack-1", {
      type: "activityStackGroup",
      activityStackGroup: {
        category: "terminal",
        events: [event("cmd-1"), event("cmd-2")],
      },
    });

    expect(collectChatItemEventIds(stack)).toEqual(
      expect.arrayContaining(["stack-1", "cmd-1", "cmd-2"])
    );
  });

  it("maps event ids to global flat indices and turn ids", () => {
    const flatItems = [item("evt-1"), item("evt-2")];
    const index = buildEventIdProjectionIndex(
      flatItems,
      [1, 1],
      [{ turnId: "turn-a" }, { turnId: "turn-b" }]
    );

    expect(index.get("evt-2")).toMatchObject({
      globalFlatIndex: 1,
      groupIndex: 1,
      turnId: "turn-b",
      itemChunkId: "evt-2",
    });
  });
});

describe("chatSearch DOM helpers", () => {
  it("finds projected rows by event id and flat index", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div ${CHAT_ITEM_ID_ATTR}="stack-1" ${CHAT_FLAT_INDEX_ATTR}="4" ${CHAT_EVENT_IDS_ATTR}="${formatChatEventIdsAttribute(["stack-1", "cmd-1"])}"></div>
    `;

    expect(
      findChatSearchTargetElement(root, { eventId: "cmd-1" })?.getAttribute(
        CHAT_ITEM_ID_ATTR
      )
    ).toBe("stack-1");
    expect(
      findChatSearchTargetElement(root, { flatIndex: 4 })?.getAttribute(
        CHAT_ITEM_ID_ATTR
      )
    ).toBe("stack-1");
  });
});
