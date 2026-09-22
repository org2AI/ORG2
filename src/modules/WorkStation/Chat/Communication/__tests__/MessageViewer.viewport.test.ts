import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBeforeViewportLayoutMutation } from "@src/components/ViewportLayoutMutationContext";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { MessageViewer } from "../MessageViewer";
import type { MessageEntry } from "../types";

let observedLayoutCallback: unknown;

const { useTranscriptViewportMock } = vi.hoisted(() => ({
  useTranscriptViewportMock: vi.fn(
    (_options: { sessionKey: string; contentKey: string }) => ({
      detachForNavigation: vi.fn(),
      handleScroll: vi.fn(),
      preserveForLayoutMutation: vi.fn(),
      setScrollRoot: vi.fn(),
    })
  ),
}));

vi.mock("jotai", () => ({ useAtomValue: () => "session-a" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@src/components/Button", () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", null, children),
}));
vi.mock("@src/engines/ChatPanel/ChatHistory/hooks/chatSearch", () => ({
  useChatSearchPanePresentation: () => ({ activeEventId: null }),
}));
vi.mock(
  "@src/engines/ChatPanel/ChatHistory/viewport/useTranscriptViewport",
  () => ({ useTranscriptViewport: useTranscriptViewportMock })
);
vi.mock("@src/engines/SessionCore", () => ({
  useStreamingDeltaForSession: () => null,
}));
vi.mock("@src/engines/SessionCore/core/atoms", () => ({
  sessionIdAtom: {},
}));
vi.mock("@src/engines/SessionCore/derived/planDisplayEvents", () => ({
  derivePlanApprovalViewState: () => ({
    getEventState: () => ({ ownsActions: false }),
  }),
  isPlanDisplayEvent: () => false,
}));
vi.mock("@src/hooks/session/usePendingPlanApproval", () => ({
  usePendingPlanApproval: () => null,
}));
vi.mock("@src/icons", () => ({
  HugeiconsIcon: () => null,
  UnfoldMoreIcon: {},
}));
vi.mock("../EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../MessageViewer/MessageBubbleRenderer", () => ({
  BubbleWrapper: ({ message }: { message: MessageEntry }) => {
    observedLayoutCallback = useBeforeViewportLayoutMutation();
    return React.createElement("div", { "data-message-id": message.eventId });
  },
  NewMessageDivider: () => null,
}));
vi.mock("../MessageViewer/planDocViewModel", () => ({
  getPlanDocStatusViewModel: () => ({ readyForReview: false, label: "" }),
  getPlanDocViewModel: () => ({ content: "", planRevisionId: null }),
  planSurfaceStatusLabel: () => "",
}));
vi.mock("../PlanDocPanel", () => ({ PlanDocPanel: () => null }));
vi.mock("../TodoKanban", () => ({ TodoKanban: () => null }));
vi.mock("../emailBubbleEvent", () => ({ isEmailBubbleEvent: () => false }));

function message(id: string): MessageEntry {
  return {
    eventId: id,
    event: {
      id,
      functionName: "assistant_message",
      sessionId: "session-a",
      args: {},
    } as SessionEvent,
    type: "chat",
    content: id,
    sender: "agent",
    timestamp: "2026-09-12T00:00:00Z",
    order: 0,
    isCurrent: true,
  };
}

describe("MessageViewer viewport ownership", () => {
  beforeEach(() => {
    useTranscriptViewportMock.mockClear();
  });

  it("provides its layout mutation callback to expandable message descendants", () => {
    renderToStaticMarkup(
      React.createElement(MessageViewer, {
        messages: [message("message-a")],
        viewMode: "chat",
        sessionReplayMode: "interactive",
        currentEventId: "event-a",
      })
    );
    expect(observedLayoutCallback).toBe(
      useTranscriptViewportMock.mock.results.at(-1)!.value
        .preserveForLayoutMutation
    );
  });

  it("keeps replay cursor changes inside one reader-intent session", () => {
    const messages = [message("message-a")];

    renderToStaticMarkup(
      React.createElement(MessageViewer, {
        messages,
        viewMode: "chat",
        sessionReplayMode: "interactive",
        currentEventId: "event-a",
      })
    );
    renderToStaticMarkup(
      React.createElement(MessageViewer, {
        messages,
        viewMode: "chat",
        sessionReplayMode: "interactive",
        currentEventId: "event-b",
      })
    );

    const firstOptions = useTranscriptViewportMock.mock.calls[0]![0];
    const secondOptions = useTranscriptViewportMock.mock.calls[1]![0];
    expect(firstOptions.sessionKey).toBe("session-a:interactive:chat");
    expect(secondOptions.sessionKey).toBe(firstOptions.sessionKey);
    expect(secondOptions.contentKey).not.toBe(firstOptions.contentKey);
  });
});
