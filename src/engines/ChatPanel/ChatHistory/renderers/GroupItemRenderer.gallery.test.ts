import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { makeSessionEvent } from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import { buildRowGroupMeta } from "../components/ChatHistoryListLayout";
import { projectChatHistory } from "../projection/core";
import {
  GroupItemRenderer,
  type GroupItemRendererProps,
} from "./GroupItemRenderer";

vi.mock("./ChatItemRenderer", () => ({
  ChatItemRenderer: ({ chatItem }: { chatItem: OptimizedChatItem }) =>
    chatItem.event?.displayText || "Final response text",
}));
vi.mock("../components/TurnMetadataFooterSlot", () => ({
  default: () => null,
}));
const props: GroupItemRendererProps = {
  flatIndex: 0,
  groupIndex: 0,
  turnId: "turn",
  previousChatItem: undefined,
  isLastItemInGroup: true,
  isLastGroup: true,
  isWpGeneWorking: false,
  chatItem: {
    chunk_id: "last",
    type: "activity",
    outputImages: ["data:image/png;base64,AAAA"],
  },
};
it("renders the gallery below the last response text", () => {
  const html = renderToStaticMarkup(createElement(GroupItemRenderer, props));
  expect(html.indexOf("output-image-gallery")).toBeGreaterThan(
    html.indexOf("Final response text")
  );
  expect(html).toContain("data:image/png;base64,AAAA");
});
it("renders the gallery even when an image-only turn has a collapsed structural row", () => {
  const html = renderToStaticMarkup(
    createElement(GroupItemRenderer, {
      ...props,
      chatItem: { ...props.chatItem!, structuralOnly: true },
    })
  );
  expect(html).toContain("output-image-gallery");
  expect(html).not.toContain("Final response text");
});
it("updates a memoized turn when only its gallery changes", () => {
  const compare = (
    GroupItemRenderer as unknown as {
      compare: (
        a: GroupItemRendererProps,
        b: GroupItemRendererProps
      ) => boolean;
    }
  ).compare;
  expect(
    compare(props, {
      ...props,
      chatItem: {
        ...props.chatItem!,
        outputImages: ["data:image/png;base64,BBBB"],
      },
    })
  ).toBe(false);
});

it("keeps both round galleries when the status footer follows the latest response", () => {
  // ChatHistoryList adds its status footer to the latest group's row count.
  const rows = buildRowGroupMeta([1, 2]);
  const html = [0, 1]
    .map((index) =>
      renderToStaticMarkup(
        createElement(GroupItemRenderer, {
          ...props,
          ...rows[index],
          flatIndex: index,
          groupIndex: index,
          turnId: `turn-${index}`,
          chatItem: {
            chunk_id: `response-${index}`,
            type: "activity",
            outputImages: [
              `data:image/png;base64,ROUND${index}A`,
              `data:image/png;base64,ROUND${index}B`,
            ],
          },
        })
      )
    )
    .join("");
  expect(rows[1].isLastItemInGroup).toBe(false);
  expect(html.match(/data-testid="output-image-gallery"/g)).toHaveLength(2);
  for (const round of [0, 1]) {
    for (const image of ["A", "B"]) {
      expect(html).toContain(`data:image/png;base64,ROUND${round}${image}`);
    }
  }
});

it.each([true, false])(
  "renders a loaded Claude screenshot before the following reply, collapsed=%s",
  (collapsed) => {
    const events = [
      makeSessionEvent({
        id: "user",
        function: "user_message",
        action_type: "raw",
        source: "user",
        displayText: "Check the page",
      }),
      makeSessionEvent({
        id: "screenshot",
        action_type: "tool_call",
        function: "mcp__claude_browser__browser_batch",
        result: {
          images: ["data:image/png;base64,AAAA"],
          output: "Screenshot captured",
        },
      }),
      makeSessionEvent({
        id: "answer",
        function: "agent_message",
        action_type: "assistant",
        displayText: "The page is ready",
        result: { content: "The page is ready" },
      }),
    ];
    const { groups } = projectChatHistory(events, {
      collapseToolActivity: true,
      groups: { tailTurnPhase: "complete", allTurnsCollapsed: collapsed },
    });
    expect(groups?.flatItems.length).toBeGreaterThanOrEqual(2);
    const html = groups!.flatItems
      .map((chatItem, index, items) =>
        renderToStaticMarkup(
          createElement(GroupItemRenderer, {
            ...props,
            chatItem,
            flatIndex: index,
            isLastItemInGroup: index === items.length - 1,
          })
        )
      )
      .join("");
    expect(html.match(/data-testid="output-image-gallery"/g)).toHaveLength(1);
    expect(html.indexOf("output-image-gallery")).toBeLessThan(
      html.indexOf("The page is ready")
    );
    expect(html).toContain("data:image/png;base64,AAAA");
  }
);
