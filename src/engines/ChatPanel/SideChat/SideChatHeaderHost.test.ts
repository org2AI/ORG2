// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatPanelSideChat from ".";
import {
  SideChatHeaderHost,
  sideChatHeaderHostAtom,
} from "./SideChatHeaderHost";

vi.mock("@src/store/chatPanel/chatPanelTabsState", async () => {
  const actual = await vi.importActual<
    typeof import("@src/store/chatPanel/chatPanelTabsState")
  >("@src/store/chatPanel/chatPanelTabsState");
  const { atom } = await import("jotai");
  return { ...actual, activeChatPanelTabTypeAtom: atom("github-issue") };
});

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
});

describe("SideChatHeaderHost", () => {
  it("moves a single launcher into a narrow pane header and releases the host on unmount", () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let width = 700;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-detail-pane-layout") ? width : 200;
      }
    );
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    const store = createStore();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = (showHeader: boolean) =>
      createElement(
        Provider,
        { store },
        showHeader
          ? createElement(
              "div",
              { "data-detail-pane-layout": true },
              createElement(
                "div",
                { role: "tablist" },
                createElement(SideChatHeaderHost)
              )
            )
          : null,
        createElement(ChatPanelSideChat)
      );
    act(() => root.render(render(true)));
    expect(
      container.querySelector('[data-testid="side-chat-floating-button"]')
    ).not.toBeNull();
    expect(store.get(sideChatHeaderHostAtom)).toBeNull();
    act(() => {
      width = 699;
      resize();
    });
    expect(
      container.querySelector('[data-testid="side-chat-floating-button"]')
    ).toBeNull();
    const headerButton = container.querySelector(
      '[data-side-chat-header-host] [data-testid="side-chat-header-button"]'
    );
    expect(headerButton).not.toBeNull();
    expect(headerButton?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(headerButton?.className).toContain("btn:bg-primary-6");
    act(() => {
      width = 0;
      resize();
    });
    expect(store.get(sideChatHeaderHostAtom)).toBeNull();
    act(() => {
      width = 699;
      resize();
    });
    expect(store.get(sideChatHeaderHostAtom)).not.toBeNull();
    act(() => {
      width = 700;
      resize();
    });
    expect(
      container.querySelector('[data-testid="side-chat-header-button"]')
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="side-chat-floating-button"]')
    ).toHaveLength(1);
    act(() => {
      width = 699;
      resize();
    });
    act(() => root.render(render(false)));
    expect(store.get(sideChatHeaderHostAtom)).toBeNull();
    expect(disconnect).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
  });
});
