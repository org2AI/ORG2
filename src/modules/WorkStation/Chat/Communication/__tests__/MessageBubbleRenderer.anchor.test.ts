import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { BubbleWrapper } from "../MessageViewer/MessageBubbleRenderer";
import type { MessageEntry } from "../types";

vi.mock("@src/engines/ChatPanel/ChatHistory/hooks/chatSearch", () => ({
  buildSearchTargetRowProps: () => ({}),
}));
vi.mock("@src/engines/SessionCore/derived/planDisplayEvents", () => ({
  isPlanDisplayEvent: () => false,
}));
vi.mock("../AgentEventBubbles", () => ({
  OrgSendMessageBubble: () => null,
  OrgTaskEventBubble: () => null,
  isOrgTaskEvent: () => false,
}));
vi.mock("../ChatBubble", () => ({
  ChatBubble: () => React.createElement("article", null, "message"),
  TodoBubble: () => null,
  UnloadedTurnBubble: () => null,
}));
vi.mock("../EmailMessageBubble", () => ({ EmailMessageBubble: () => null }));
vi.mock("../ThinkBubble", () => ({ ThinkBubble: () => null }));
vi.mock("../emailBubbleEvent", () => ({ isEmailBubbleEvent: () => false }));
vi.mock("../MessageViewer/InteractionRenderers", () => ({
  renderInteractionWidget: () => null,
  renderPlanDocCard: () => null,
}));

describe("BubbleWrapper transcript anchor", () => {
  it("uses the immutable message id as the workstation viewport anchor", () => {
    const message: MessageEntry = {
      eventId: "message-anchor-a",
      event: {
        id: "event-a",
        functionName: "assistant_message",
      } as SessionEvent,
      type: "chat",
      content: "hello",
      sender: "agent",
      timestamp: "2026-09-12T00:00:00Z",
      order: 0,
      isCurrent: true,
    };

    const markup = renderToStaticMarkup(
      React.createElement(BubbleWrapper, {
        message,
        viewMode: "chat",
        index: 0,
        total: 1,
      })
    );

    expect(markup).toContain('data-transcript-anchor-id="message-anchor-a"');
  });
});
