// @vitest-environment jsdom
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { SettingsNavigationGroup } from "@src/config/settingsNavigation";
import { Settings01Icon } from "@src/icons";
import SectionRow from "@src/modules/shared/layouts/SectionLayout/Row";
import * as settingsControls from "@src/modules/shared/layouts/blocks/SettingsSearchDropdown/settingsControlSearch";

import { SettingsRootBody } from "./SettingsSidebar";

vi.mock("react-i18next", () => {
  const labels: Record<string, string> = {
    "settings:searchPlaceholder": "Search settings...",
    "common:tooltips.clearSearch": "Clear search",
    "settings:general.lightSkin": "浅色皮肤",
    "settings:general.darkSkin": "深色皮肤",
    "settings:general.lightAccent": "浅色强调色",
    "settings:general.darkAccent": "深色强调色",
    "settings:general.accent": "强调色",
  };
  const t = (key: string, options?: { query?: string }) =>
    key === "settings:noSettingsFound"
      ? `No settings found for "${options?.query ?? ""}"`
      : (labels[key] ?? key);
  return { useTranslation: () => ({ t }) };
});

const NAVIGATION_GROUPS: readonly SettingsNavigationGroup[] = [
  {
    id: "app",
    label: null,
    items: [
      {
        id: "general",
        label: "通用",
        path: "/orgii/app/settings/app/general",
        icon: Settings01Icon,
        groupId: "app",
        dataTestId: "settings-core-item-general",
      },
      {
        id: "appearance",
        label: "外观",
        path: "/orgii/app/settings/app/appearance",
        icon: Settings01Icon,
        groupId: "app",
        dataTestId: "settings-core-item-appearance",
      },
    ],
  },
  {
    id: "tools",
    label: "Agent tools",
    items: [
      {
        id: "externalSkillsets",
        label: "Skills、MCPs、Plugins",
        path: "/orgii/app/settings/integrations/skills-mcps-plugins",
        icon: Settings01Icon,
        groupId: "tools",
        dataTestId: "settings-core-item-externalSkillsets",
      },
    ],
  },
];

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsRootBody search integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();
  const onSelectControl = vi.fn();
  const scrollIntoView = vi.fn();

  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };

  it.each([
    ["OpenAI", "models", "key-add", "openai_api"],
    ["github", "connections", "channel-add", "github"],
  ] as const)(
    "opens %s setup through navigation, not control reveal",
    async (query, pageId, wizard, provider) => {
      await renderBody({
        navigationGroups: [
          {
            id: "setup",
            label: null,
            items: [
              {
                ...NAVIGATION_GROUPS[0].items[0],
                id: pageId,
                label: pageId,
                path: `/orgii/app/settings/integrations/${pageId}`,
              },
            ],
          },
        ],
      });
      const input = container.querySelector("input")!;
      await act(async () => setInputValue(input, query));
      const row = container.querySelector<HTMLElement>(
        `[data-testid="settings-navigation-search-result-setup-${pageId === "models" ? "add-key-openai_api" : "connect-github"}"]`
      )!;
      expect(row).not.toBeNull();
      await act(async () => row.click());
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          path: `/orgii/app/settings/integrations/${pageId}?wizard=${wizard}&setupProvider=${provider}`,
        })
      );
      expect(onSelectControl).not.toHaveBeenCalled();
    }
  );

  async function renderBody(
    props: Partial<React.ComponentProps<typeof SettingsRootBody>> = {},
    label = "语言"
  ): Promise<void> {
    await act(async () => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            { "data-settings-surface": true },
            React.createElement(
              SectionRow,
              { label },
              React.createElement("button", { type: "button" }, "Choose")
            ),
            React.createElement(SectionRow, {
              label: "浅色皮肤",
              settingsSearchKeys: "general.lightSkin",
            })
          ),
          React.createElement(SettingsRootBody, {
            navigationGroups: NAVIGATION_GROUPS,
            activeItemId: "general",
            searchScopeKey: "/orgii/app/settings/app/general/general",
            onSelect,
            onSelectControl,
            ...props,
          })
        )
      );
    });
  }

  function input(): HTMLInputElement {
    const field = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-navigation-search-input"]'
    );
    if (!field) throw new Error("Missing settings search input");
    return field;
  }

  function key(value: string, isComposing = false): void {
    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
          isComposing,
        })
      );
    });
  }

  beforeAll(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  beforeEach(async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSelect.mockClear();
    onSelectControl.mockClear();
    scrollIntoView.mockClear();
    await renderBody();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    container.remove();
    document
      .querySelectorAll('[data-testid="settings-navigation-search-panel"]')
      .forEach((panel) => panel.remove());
  });

  afterAll(() => {
    Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  async function search(query: string): Promise<void> {
    await act(async () => {
      setInputValue(input(), query);
    });
  }

  it("keeps Settings search and finds localized controls and MCP destinations", async () => {
    await search("皮肤");
    expect(
      document.body.querySelector(
        '[data-testid="settings-navigation-search-result-setting-general-lightSkin"]'
      )
    ).not.toBeNull();

    await search("强调色");
    expect(
      document.body.querySelector(
        '[data-testid="settings-navigation-search-result-setting-general-primaryColorLight"]'
      )
    ).not.toBeNull();

    await search("MCP");
    expect(
      document.body.querySelector(
        '[data-testid="settings-navigation-search-result-externalSkillsets"]'
      )
    ).not.toBeNull();
  });

  it("replaces navigation with one inline heading per page and indented controls", async () => {
    expect(
      container.querySelector('[data-testid="settings-core-item-general"]')
    ).not.toBeNull();
    await search("皮肤");
    const results = container.querySelector(
      '[data-testid="settings-navigation-search-results"]'
    );
    expect(results).not.toBeNull();
    expect(results?.closest(".sidebar-list")).not.toBeNull();
    expect(
      document.querySelector('[data-testid="settings-navigation-search-panel"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="settings-core-item-general"]')
    ).toBeNull();
    expect(
      results?.querySelectorAll('[data-settings-search-page="appearance"]')
    ).toHaveLength(1);
    expect(
      results?.querySelectorAll(
        '[data-testid="settings-navigation-search-result-appearance"]'
      )
    ).toHaveLength(1);
    expect(results?.querySelectorAll('[role="option"]')).toHaveLength(3);
    const result = results?.querySelector(
      '[data-testid="settings-navigation-search-result-setting-general-lightSkin"]'
    );
    expect(
      result
        ?.closest("[data-settings-search-page]")
        ?.getAttribute("data-settings-search-page")
    ).toBe("appearance");
    expect(result?.querySelector("svg")).toBeNull();
    expect(input().getAttribute("aria-controls")).toBe(results?.id);
  });

  it("navigates to a matching control's exact tab and clears search", async () => {
    await search("皮肤");
    key("End");
    const activeId = input().getAttribute("aria-activedescendant");
    expect(document.getElementById(activeId ?? "")?.textContent).toBe(
      "深色皮肤"
    );
    expect(scrollIntoView).toHaveBeenCalled();
    key("Enter", true);
    expect(onSelectControl).not.toHaveBeenCalled();
    key("Enter");
    expect(onSelectControl).toHaveBeenCalledWith(
      expect.objectContaining({
        searchKey: "general.darkSkin",
        path: "/orgii/app/settings/app/appearance/app",
      })
    );
    expect(input().value).toBe("");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector('[data-testid="settings-core-item-general"]')
    ).not.toBeNull();
  });

  it("selects the actual control match with Enter instead of its page heading", async () => {
    await search("皮肤");
    key("Enter");
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSelectControl).toHaveBeenCalledWith(
      expect.objectContaining({ searchKey: "general.lightSkin" })
    );
  });

  it("invalidates removed pages and resets keyboard selection when navigation visibility changes", async () => {
    await search("皮肤");
    key("End");
    await renderBody({
      navigationGroups: NAVIGATION_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => item.id !== "appearance"),
      })),
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    key("Enter");
    expect(onSelectControl).not.toHaveBeenCalled();
    await renderBody();
    key("Enter");
    expect(onSelectControl).toHaveBeenCalledWith(
      expect.objectContaining({ searchKey: "general.lightSkin" })
    );
  });

  it("makes page-only matches navigable and clears no-match results with Escape or the button", async () => {
    await search("MCP");
    key("ArrowDown");
    key("Enter");
    expect(onSelect).toHaveBeenCalledWith(NAVIGATION_GROUPS[1].items[0]);
    await search("no-such-setting-987654");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "no-such-setting-987654"
    );
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
    key("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    key("Escape");
    expect(input().value).toBe("");
    await search("MCP");
    const clearButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear search"]'
    );
    expect(clearButton).not.toBeNull();
    act(() => clearButton?.click());
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
  });

  it("scans visible rows once per search session, refreshes on refocus, and does no idle/hidden scanning", async () => {
    const collect = vi.spyOn(
      settingsControls,
      "collectRenderedSettingsControls"
    );
    act(() => input().focus());
    expect(collect).not.toHaveBeenCalled();
    await search("语");
    await search("语言");
    await search("MCP");
    expect(collect).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(collect).toHaveBeenCalledTimes(1);
    act(() => input().blur());
    await renderBody({}, "新增选项");
    act(() => input().focus());
    await search("新增选项");
    expect(collect).toHaveBeenCalledTimes(2);
    const row = container.querySelector(
      '[data-settings-search-page="general"]'
    );
    expect(row?.textContent).toContain("新增选项");
    await search("");
    await search("新增");
    expect(collect).toHaveBeenCalledTimes(3);
  });

  it("resets query and snapshots on route changes and preserves the current tab for mounted controls", async () => {
    await search("语言");
    const target = container.querySelector<HTMLElement>(
      '[data-settings-search-page="general"] [role="option"]:last-child'
    );
    act(() => target?.click());
    expect(onSelectControl).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: expect.any(String),
        path: "/orgii/app/settings/app/general/general",
      })
    );
    await search("语言");
    await renderBody(
      {
        activeItemId: "appearance",
        searchScopeKey: "/orgii/app/settings/app/appearance/code-editor",
      },
      "Editor preview"
    );
    expect(input().value).toBe("");
    await search("语言");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await search("Editor preview");
    const preview = container.querySelector<HTMLElement>(
      '[data-settings-search-page="appearance"] [role="option"]:last-child'
    );
    expect(preview?.textContent).toBe("Editor preview");
    act(() => preview?.click());
    expect(onSelectControl).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/orgii/app/settings/app/appearance/code-editor",
      })
    );
  });
});
