import { describe, expect, it, vi } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import {
  GroupItemRenderer,
  type GroupItemRendererProps,
} from "./GroupItemRenderer";

vi.mock("./ChatItemRenderer", () => ({ ChatItemRenderer: () => null }));
vi.mock("../components/TurnMetadataFooterSlot", () => ({
  default: () => null,
}));
vi.mock("../hooks/useChatGroups", () => ({
  getUnloadedTurnMeta: () => undefined,
  isTurnPreviewItem: () => false,
}));

const compare = (
  GroupItemRenderer as unknown as {
    compare: (
      left: GroupItemRendererProps,
      right: GroupItemRendererProps
    ) => boolean;
  }
).compare;

describe("GroupItemRenderer terminal collapse updates", () => {
  it.each([true, false])(
    "updates the collapse boundary with failed=%s",
    (failed) => {
      const events = [
        makeSessionEvent({
          action_type: "tool_call",
          function: "run_shell",
          args: { command: "python3" },
          result: { success: !failed },
        }),
      ];
      const previous: GroupItemRendererProps = {
        flatIndex: 0,
        groupIndex: 0,
        turnId: null,
        chatItem: {
          chunk_id: "terminal-group",
          type: "activityStackGroup",
          activityStackGroup: {
            category: "terminal",
            events,
            closedByBoundary: false,
          },
        },
        previousChatItem: undefined,
        isLastItemInGroup: false,
        isLastGroup: false,
        isWpGeneWorking: false,
      };
      expect(compare(previous, { ...previous })).toBe(true);
      // Active parent controls must still invalidate the memoized row.
      expect(compare(previous, { ...previous, isWpGeneWorking: true })).toBe(
        false
      );
      expect(compare(previous, { ...previous, onRegenerate: vi.fn() })).toBe(
        false
      );
      expect(
        compare(previous, { ...previous, onEditUserMessage: vi.fn() })
      ).toBe(false);
      expect(
        compare(previous, {
          ...previous,
          chatItem: {
            ...previous.chatItem!,
            activityStackGroup: {
              category: "terminal",
              events,
              closedByBoundary: true,
            },
          },
        })
      ).toBe(false);
    }
  );
});
