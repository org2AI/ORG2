// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkstationTabHost } from "@src/store/workstation/tabHost";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";

import { useWorkStationTabShortcutBridge } from "./useWorkStationTabShortcutBridge";

const CLOSE_EVENT = "workstation-close-active-tab";

/**
 * The AppShell keeps previously-visited hosts mounted-but-hidden, so several
 * hosts listen for ⌘W at once. Only the one owning the active tab may act on
 * it — otherwise one keystroke closes a tab the user cannot see.
 */
describe("workstation tab shortcut bridge", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;

  function setActiveTabType(type: string) {
    store.set(workstationLayoutAtom, {
      mainPane: {
        tabs: [{ id: "t1", type, title: "t", data: {} }],
        activeTabId: "t1",
      },
    } as unknown as never);
  }

  function Host({
    host,
    onClose,
    enabled,
  }: {
    host: WorkstationTabHost;
    onClose: () => void;
    enabled?: boolean;
  }) {
    useWorkStationTabShortcutBridge({
      host,
      enabled,
      onCloseActiveTab: onClose,
    });
    return null;
  }

  function renderHosts(
    hosts: Array<{
      host: WorkstationTabHost;
      onClose: () => void;
      enabled?: boolean;
    }>
  ) {
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          ...hosts.map((props, index) =>
            React.createElement(Host, { key: index, ...props })
          )
        )
      );
    });
  }

  function pressCloseShortcut() {
    act(() => {
      window.dispatchEvent(new CustomEvent(CLOSE_EVENT));
    });
  }

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = createStore();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  });

  it("closes only in the host that owns the active tab", () => {
    const code = vi.fn();
    const project = vi.fn();
    setActiveTabType("file"); // projects onto the code host
    renderHosts([
      { host: "code", onClose: code },
      { host: "project", onClose: project },
    ]);

    pressCloseShortcut();

    expect(code).toHaveBeenCalledTimes(1);
    expect(project).not.toHaveBeenCalled();
  });

  it("follows the active tab when it moves to another host", () => {
    const code = vi.fn();
    const project = vi.fn();
    setActiveTabType("file");
    renderHosts([
      { host: "code", onClose: code },
      { host: "project", onClose: project },
    ]);

    act(() => setActiveTabType("project-dashboard"));
    pressCloseShortcut();

    expect(project).toHaveBeenCalledTimes(1);
    expect(code).toHaveBeenCalledTimes(0);
  });

  it("never fires more than one handler for one keystroke", () => {
    const calls: string[] = [];
    setActiveTabType("browser-session");
    renderHosts([
      { host: "code", onClose: () => calls.push("code") },
      { host: "browser", onClose: () => calls.push("browser") },
      { host: "project", onClose: () => calls.push("project") },
    ]);

    pressCloseShortcut();

    expect(calls).toEqual(["browser"]);
  });

  it("lets an explicit enabled:false narrow the condition further", () => {
    const browser = vi.fn();
    setActiveTabType("browser-session");
    renderHosts([{ host: "browser", onClose: browser, enabled: false }]);

    pressCloseShortcut();

    expect(browser).not.toHaveBeenCalled();
  });

  it("stops listening once unmounted", () => {
    const code = vi.fn();
    setActiveTabType("file");
    renderHosts([{ host: "code", onClose: code }]);
    act(() => root.render(React.createElement(React.Fragment)));

    pressCloseShortcut();

    expect(code).not.toHaveBeenCalled();
  });
});
