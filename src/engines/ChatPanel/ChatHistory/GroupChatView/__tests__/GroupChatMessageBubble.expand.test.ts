// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ViewportLayoutMutationProvider } from "@src/components/ViewportLayoutMutationContext";

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

describe("GroupChatMessageBubble expand interaction", () => {
  let scrollHeightDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this.textContent?.length ?? 0) > 200 ? 800 : 0;
      },
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (scrollHeightDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        scrollHeightDescriptor
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    }
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("routes the real Group Chat Expand and Collapse buttons through the viewport owner", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const calls: string[] = [];

    act(() => {
      root.render(
        React.createElement(
          ViewportLayoutMutationProvider,
          { value: () => calls.push("before-layout-mutation") },
          React.createElement(GroupChatMessageBubble, {
            senderName: "Reviewer",
            recipientName: null,
            bodyMarkdown: `GROUP_EXPAND ${"long message ".repeat(80)}`,
            timestamp: "2026-01-01T00:00:00Z",
            showSenderChrome: true,
          })
        )
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="expand-overlay-toggle"]'
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    act(() => toggle?.click());
    expect(calls).toEqual(["before-layout-mutation"]);
    expect(
      container
        .querySelector('[data-testid="expand-overlay-toggle"]')
        ?.getAttribute("aria-expanded")
    ).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="expand-overlay-toggle"]'
        )
        ?.click()
    );
    expect(calls).toEqual(["before-layout-mutation", "before-layout-mutation"]);
    expect(
      container
        .querySelector('[data-testid="expand-overlay-toggle"]')
        ?.getAttribute("aria-expanded")
    ).toBe("false");

    act(() => root.unmount());
    container.remove();
  });
});
