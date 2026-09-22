import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubagentChatPane } from "./SubagentChatPane";

const { chatHistoryPropsMock } = vi.hoisted(() => ({
  chatHistoryPropsMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock(
  "@src/engines/SessionCore/derived/sessionScopedChatEvents",
  async () => {
    const { atom } = await import("jotai");
    const events = atom([
      {
        id: "event-a",
        createdAt: "2026-09-12T00:00:00Z",
        functionName: "assistant_message",
      },
    ]);
    return { chatEventsForSessionAtomFamily: () => events };
  }
);
vi.mock("@src/engines/ChatPanel/ChatHistory", () => ({
  default: (props: unknown) => {
    chatHistoryPropsMock(props);
    return null;
  },
}));
vi.mock("./SubagentPromptToggle", () => ({
  SubagentPromptToggle: () => null,
}));

describe("SubagentChatPane viewport ownership", () => {
  beforeEach(() => {
    chatHistoryPropsMock.mockClear();
  });

  it("keeps member workstation cells on the shared reader-controlled policy", () => {
    renderToStaticMarkup(
      React.createElement(SubagentChatPane, {
        sessionId: "member-a",
        isSessionLive: true,
      })
    );

    const props = chatHistoryPropsMock.mock.calls[0]?.[0];
    expect(props).not.toHaveProperty("tailFollowMode", "always");
  });
});
