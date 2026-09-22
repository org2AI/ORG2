// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CREATOR_LAUNCHPAD_ACTIONS_VISIBLE_STORAGE_KEY,
  creatorLaunchpadActionsVisibleAtom,
} from "@src/store/session/creatorLaunchpadActionsVisibleAtom";
import {
  CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY,
  creatorLaunchpadSearchVisibleAtom,
} from "@src/store/session/creatorLaunchpadSearchVisibleAtom";
import {
  PINNED_ACTIONS_VISIBLE_STORAGE_KEY,
  pinnedActionsVisibleAtom,
} from "@src/store/session/pinnedActionsVisibleAtom";
import { settingsAtom } from "@src/store/settings/settingsAtom";

import { NewChatHeaderActionsMenu } from "./NewChatHeaderActionsMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/hooks/dropdown", () => ({
  getDropdownPanelStyle: () => ({}),
  useDropdownEngine: () => ({
    isOpen: true,
    isPositioned: true,
    toggle: vi.fn(),
    close: vi.fn(),
    triggerRef: { current: null },
    panelRef: { current: null },
    panelPosition: { left: 0, top: 0, width: 220 },
  }),
}));

vi.mock("@src/components/Dropdown/ActionMenuSurface", async () => {
  const React = await import("react");
  return {
    ActionMenuSurface: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
    ActionSubmenu: ({
      children,
      dataTestId,
    }: {
      children: React.ReactNode;
      dataTestId?: string;
    }) => React.createElement("div", { "data-testid": dataTestId }, children),
  };
});

describe("NewChatHeaderActionsMenu", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.removeItem(CREATOR_LAUNCHPAD_ACTIONS_VISIBLE_STORAGE_KEY);
    localStorage.removeItem(PINNED_ACTIONS_VISIBLE_STORAGE_KEY);
    localStorage.removeItem(CREATOR_LAUNCHPAD_SEARCH_VISIBLE_STORAGE_KEY);
    store = createStore();
    store.set(creatorLaunchpadActionsVisibleAtom, true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        createElement(
          Provider,
          { store },
          createElement(NewChatHeaderActionsMenu)
        )
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    vi.clearAllMocks();
  });

  it("toggles the persisted launchpad quick-action preference", () => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="new-chat-show-quick-actions-toggle"]'
    );

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-label")).toBe(
      "chat.startPage.showQuickActions"
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    act(() => toggle?.click());

    expect(store.get(creatorLaunchpadActionsVisibleAtom)).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles the persisted launchpad Spotlight preference", () => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="new-chat-show-spotlight-toggle"]'
    );

    expect(toggle?.getAttribute("aria-label")).toBe(
      "chat.startPage.showSpotlight"
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    act(() => toggle?.click());

    expect(store.get(creatorLaunchpadSearchVisibleAtom)).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
  });

  it("splits the controls into UI settings and input settings", () => {
    const controlIds = (submenu: string) =>
      [
        ...document
          .querySelector(`[data-testid="${submenu}"]`)!
          .querySelectorAll("[data-testid]"),
      ].map((node) => node.getAttribute("data-testid"));

    expect(controlIds("new-chat-ui-settings-submenu")).toEqual([
      "new-chat-show-spotlight-toggle",
      "new-chat-composer-position",
      "new-chat-show-quick-actions-toggle",
      "new-chat-show-cli-update-toggle",
    ]);
    const uiSubmenuChildren = [
      ...document.querySelector('[data-testid="new-chat-ui-settings-submenu"]')!
        .children,
    ];
    expect(uiSubmenuChildren[1]?.getAttribute("role")).toBe("separator");
    expect(controlIds("new-chat-input-settings-submenu")).toEqual([
      "new-chat-repo-bar-position",
      "new-chat-send-on-enter",
      "new-chat-show-skills-toggle",
      "new-chat-composer-glow-toggle",
      "new-chat-separate-effort-pill-toggle",
    ]);
  });

  it("writes the shared send-shortcut setting from the input submenu", () => {
    const pill = document.querySelector<HTMLElement>(
      '[data-testid="new-chat-send-on-enter"]'
    );

    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("aria-label")).toBe("chat.sendMethod");
    const options = pill!.querySelectorAll<HTMLButtonElement>(
      "button[aria-pressed]"
    );
    expect(
      [...options].map((node) => node.getAttribute("aria-pressed"))
    ).toEqual(["false", "true"]);

    act(() => options[0]?.click());

    expect(store.get(settingsAtom)["chat.sendOnEnter"]).toBe(true);
    expect(options[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the skills toggle off by default and can enable pinned skills", () => {
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="new-chat-show-skills-toggle"]'
    );

    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-label")).toBe(
      "chat.startPage.showSkills"
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    act(() => toggle?.click());

    expect(store.get(pinnedActionsVisibleAtom)).toBe(true);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
  });
});
