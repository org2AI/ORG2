// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chatPanelCompanionAtom } from "@src/store/chatPanel/chatPanelCompanionAtom";
import { createSessionTab } from "@src/store/chatPanel/chatPanelTabFactories";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";
import { chatPanelTabsAtom } from "@src/store/chatPanel/chatPanelTabsState";
import {
  createInstrumentedStore,
  resetInstrumentedStore,
} from "@src/util/core/state/instrumentedStore";

import { ChatPanelShell } from "./ChatPanelShell";
import { ChatPanelChrome } from "./header/ChatPanelChrome";
import { resolveChatPanelChromeTopInsetPx } from "./header/chatPanelHeaderLayout";
import { openSessionSources } from "./sessionSources/openSessionSources";

const mounts = vi.hoisted(() => ({ chat: 0, sources: 0, dispose: 0 }));
vi.mock("./TabContent/UnifiedChatPanelTabContent", () => ({
  UnifiedChatPanelTabContent: ({
    chatColumn,
  }: {
    chatColumn: React.ReactNode;
  }) => chatColumn,
}));
vi.mock("@src/features/SessionSources/SessionSourcesContent", () => ({
  SessionSourcesContent: ({ sessionId }: { sessionId: string }) => {
    useEffect(() => {
      mounts.sources++;
      return () => {
        mounts.dispose++;
      };
    }, []);
    return React.createElement(
      "div",
      { "data-source-session": sessionId },
      "Sources body"
    );
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function Chat() {
  useEffect(() => {
    mounts.chat++;
  }, []);
  return React.createElement("input", {
    "aria-label": "Draft",
    defaultValue: "unsent message",
  });
}
let root: Root;
let host: HTMLDivElement;
let store: ReturnType<typeof createInstrumentedStore>;
let chat: ChatPanelTab;
async function render(
  activeTab: ChatPanelTab = chat,
  chrome?: { overlay: boolean; collapsed: boolean }
) {
  await act(async () =>
    root.render(
      React.createElement(
        Provider,
        { store },
        React.createElement(ChatPanelShell, {
          activeTab,
          chatColumn: React.createElement(Chat),
          focusedWorkstationRail: React.createElement(
            "div",
            { "data-rail": true },
            "Summary"
          ),
          borderClasses: "",
          chatPanelOpacityStyle: {},
          chatWidth: 1000,
          chatWidthStyleValue: "100%",
          fullScreen: true,
          hasTabBar: false,
          chromeTopInset: chrome
            ? resolveChatPanelChromeTopInsetPx(chrome.overlay, chrome.collapsed)
            : 0,
          headerSection: chrome
            ? React.createElement(ChatPanelChrome, {
                tabStrip: "Session tab",
                toolbar: "Chat actions",
                publishedHeaderSlots: { content: "Conversation" },
                overlayPublishedHeader: chrome.overlay,
                tabRowCollapsed: chrome.collapsed,
              })
            : null,
          isDragging: false,
          isLeftPosition: true,
          isTerminalTabActive: false,
          onResizeMouseDown: () => {},
          panelRef: React.createRef<HTMLDivElement>(),
          resizeTooltipLabel: "Resize",
          resizeTooltipShortcut: "",
          sessionModals: null,
          showResizeHandle: false,
          terminalTabs: [],
          useExternalWidth: true,
        })
      )
    )
  );
}
async function open() {
  await act(async () => {
    openSessionSources(chat.sessionId!, "Sources");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  resetInstrumentedStore();
  store = createInstrumentedStore();
  chat = createSessionTab({ sessionId: "a" });
  store.set(chatPanelTabsAtom, { tabs: [chat], activeTabId: chat.id });
  mounts.chat = mounts.sources = mounts.dispose = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetInstrumentedStore();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});
describe("ChatPanel companion composition", () => {
  it("reserves floating chrome space through collapsed, expanded and in-flow headers", async () => {
    await render(chat, { overlay: true, collapsed: true });
    const input = host.querySelector("input");
    await open();
    const pane = host.querySelector<HTMLElement>(
      '[data-testid="chat-panel-companion"]'
    )!;
    for (const [overlay, collapsed, inset] of [
      [true, true, 44],
      [true, false, 80],
      [false, false, 0],
      [true, true, 44],
    ] as const) {
      await render(chat, { overlay, collapsed });
      expect(
        host.querySelector('[data-testid="chat-panel-header-surface"]')
      ).not.toBeNull();
      expect(pane.style.marginTop).toBe(`${inset}px`);
      expect((pane.previousElementSibling as HTMLElement).style.marginTop).toBe(
        `${inset}px`
      );
      expect(host.querySelector('[data-testid="chat-panel-companion"]')).toBe(
        pane
      );
      expect(host.querySelector("input")).toBe(input);
    }
    expect(mounts.chat).toBe(1);
    expect(mounts.sources).toBe(1);
    expect(mounts.dispose).toBe(0);
  });
  it("keeps the chat DOM and draft mounted through open, repeat-open and close", async () => {
    await render();
    const input = host.querySelector("input")!;
    input.value = "still composing";
    await open();
    expect(host.querySelector('[data-source-session="a"]')).not.toBeNull();
    expect(host.querySelector("[data-rail]")).toBeNull();
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("still composing");
    await open();
    expect(mounts.sources).toBe(1);
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="common:actions.close"]'
        )!
        .click()
    );
    expect(
      host.querySelector('[data-testid="chat-panel-companion"]')
    ).toBeNull();
    expect(host.querySelector("[data-rail]")).not.toBeNull();
    expect(host.querySelector("input")).toBe(input);
    expect(mounts.chat).toBe(1);
    expect(mounts.dispose).toBe(1);
  });
  it("closes on session switch and never shows the previous session on return", async () => {
    await render();
    await open();
    await render({ ...chat, sessionId: "b" });
    expect(host.querySelector("[data-source-session]")).toBeNull();
    expect(store.get(chatPanelCompanionAtom)).toBeNull();
    expect(mounts.dispose).toBe(1);
    await render();
    expect(host.querySelector("[data-source-session]")).toBeNull();
  });
  it("closes when switching to another tab or unmounting the shell", async () => {
    await render();
    await open();
    await render({ ...chat, id: "other", type: "start-page" });
    expect(store.get(chatPanelCompanionAtom)).toBeNull();
    await render();
    await open();
    act(() => root.render(null));
    expect(store.get(chatPanelCompanionAtom)).toBeNull();
    expect(mounts.dispose).toBe(2);
  });
  it("opens the same content in Station only through the explicit action", async () => {
    await render();
    await open();
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="sessions:chat.moveToWorkstation"]'
        )!
        .click()
    );
    expect(store.get(chatPanelCompanionAtom)).toBeNull();
    expect(host.querySelector("[data-source-session]")).toBeNull();
    expect(host.querySelector("input")).not.toBeNull();
  });
});
