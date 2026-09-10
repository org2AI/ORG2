// @vitest-environment jsdom
import { Provider } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigationSidebarTabsAtom } from "@src/store/ui/navigationSidebarTabsAtom";
import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { useSyncBrowserTabs } from "./useSyncGlobalTabs";

vi.mock("@src/util/platform/tauri", () => ({ isTauriDesktop: () => false }));

describe("global tab context sync", () => {
  let root: Root;
  let store: ReturnType<typeof createInstrumentedStore>;
  type Props = {
    browsers: Parameters<typeof useSyncBrowserTabs>[0];
    activeBrowser: string;
  };

  function Harness(props: Props) {
    useSyncBrowserTabs(props.browsers, props.activeBrowser);
    return null;
  }

  function render(props: Props) {
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(Harness, props)
        )
      );
    });
  }

  beforeEach(() => {
    localStorage.clear();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    store = createInstrumentedStore();
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    localStorage.clear();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("syncs additions, selection, metadata and removals while preserving stored non-context tabs", () => {
    const editor = [{ id: "repo", name: "Repo", isActive: true, timestamp: 1 }];
    const terminal = [
      { id: "legacy", name: "Legacy", isActive: true, timestamp: 1 },
    ];
    store.set(navigationSidebarTabsAtom, {
      ...store.get(navigationSidebarTabsAtom),
      editor,
      terminal,
    });
    const initial: Props = {
      browsers: [
        { id: "b1", title: "One", url: "https://example.com", incognito: true },
        { id: "b2", title: "Two" },
      ],
      activeBrowser: "b1",
    };
    render(initial);
    let state = store.get(navigationSidebarTabsAtom);
    expect(state.browser).toHaveLength(2);
    expect(state.browser.find((tab) => tab.isActive)).toMatchObject({
      id: "b1",
      isPrivate: true,
    });

    render({ ...initial, activeBrowser: "b2" });
    state = store.get(navigationSidebarTabsAtom);
    expect(state.browser.find((tab) => tab.isActive)?.id).toBe("b2");

    const updated: Props = {
      browsers: [{ id: "b2", title: "Updated", url: "https://example.org" }],
      activeBrowser: "b2",
    };
    render(updated);
    state = store.get(navigationSidebarTabsAtom);
    expect(state.browser).toEqual([
      expect.objectContaining({
        id: "b2",
        title: "Updated",
        url: "https://example.org",
        isActive: true,
      }),
    ]);
    expect(state.editor).toEqual(editor);

    const onChange = vi.fn();
    const unsubscribe = store.sub(navigationSidebarTabsAtom, onChange);
    render({
      ...updated,
      browsers: [...updated.browsers],
    });
    expect(onChange).not.toHaveBeenCalled();
    unsubscribe();

    render({
      browsers: [],
      activeBrowser: "",
    });
    expect(store.get(navigationSidebarTabsAtom)).toMatchObject({
      browser: [],
      terminal,
      editor,
    });
    render(initial);
    expect(store.get(navigationSidebarTabsAtom).browser).toHaveLength(2);
  });
});
