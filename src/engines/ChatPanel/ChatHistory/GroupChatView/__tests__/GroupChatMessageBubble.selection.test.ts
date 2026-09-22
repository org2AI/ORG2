// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import GroupChatMessageBubble from "../GroupChatMessageBubble";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "en" },
  }),
}));

vi.mock("@src/components/MarkDown", () => ({
  default: ({ textContent }: { textContent: string }) =>
    React.createElement("p", null, textContent),
}));

vi.mock("@src/util/data/formatters/date", () => ({
  formatSmartDateTime: () => "visible time",
  toIntlLocaleTag: () => "en-US",
}));

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe("GroupChatMessageBubble text selection", () => {
  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("opts the complete Group Chat message body into text selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(GroupChatMessageBubble, {
          senderName: "User",
          recipientName: "Reviewer",
          bodyMarkdown: "GROUP_COPY first line\nsecond line",
          timestamp: "2026-01-01T00:00:00Z",
          showSenderChrome: true,
          clampContent: false,
        })
      );
    });

    const selectableBody = container.querySelector(".allow-select-deep");
    expect(selectableBody?.textContent).toContain("@Reviewer  GROUP_COPY");
    expect(selectableBody?.textContent).toContain("second line");
    expect(
      Array.from(selectableBody?.querySelectorAll("span") ?? []).some(
        (element) => element.textContent === "GROUP_COPY first line"
      )
    ).toBe(true);
    expect(
      selectableBody?.closest('[data-testid="agent-org-group-chat-message"]')
    ).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
