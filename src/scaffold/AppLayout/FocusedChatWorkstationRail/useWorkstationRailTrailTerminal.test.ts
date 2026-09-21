// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  miniTerminalHostMountedAtom,
  miniTerminalSuppressedIdsAtom,
  miniTerminalVisibleAtom,
} from "@src/store/ui/miniTerminalAtom";
import { terminalSessionsAtom } from "@src/store/workstation/codeEditor/terminal";

import { useWorkstationRailTrailTerminal } from "./useWorkstationRailTrailTerminal";

vi.mock("./useWorkstationTrailMenu", () => ({
  useWorkstationTrailMenu: () => vi.fn(),
}));

/**
 * The rail stays mounted when it collapses to its 44px track, but the track
 * has no room for the terminal panel. Suppression must follow the panel, not
 * the hook: a claimed PTY suppressed with no xterm anywhere is unreachable
 * from the Workstation pane *and* from the rail's own Opened Tabs list.
 */
describe("trail terminal host claim", () => {
  let root: Root;
  let container: HTMLDivElement;
  let store: ReturnType<typeof createStore>;

  function Probe({ collapsed }: { collapsed: boolean }) {
    useWorkstationRailTrailTerminal({ collapsed });
    return null;
  }

  function render(collapsed: boolean) {
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(Probe, { collapsed })
        )
      );
    });
  }

  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = createStore();
    // One live Workstation session, claimed and shown by the panel.
    store.set(terminalSessionsAtom, [
      { id: "pty-1", name: "zsh" },
    ] as unknown as never);
    store.set(miniTerminalVisibleAtom, true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  });

  it("claims the host while the rail is expanded", () => {
    render(false);
    expect(store.get(miniTerminalHostMountedAtom)).toBe(true);
  });

  it("releases the host when the rail collapses, so no session stays suppressed", () => {
    render(false);
    expect(store.get(miniTerminalHostMountedAtom)).toBe(true);

    render(true);
    expect(store.get(miniTerminalHostMountedAtom)).toBe(false);
    expect([...store.get(miniTerminalSuppressedIdsAtom)]).toEqual([]);
  });

  it("never claims the host when the rail mounts already collapsed", () => {
    render(true);
    expect(store.get(miniTerminalHostMountedAtom)).toBe(false);
  });

  it("reclaims the host when the rail expands again", () => {
    render(true);
    render(false);
    expect(store.get(miniTerminalHostMountedAtom)).toBe(true);
  });

  it("does not render the panel while collapsed", () => {
    // Rendered into the DOM rather than captured in a closure: assigning to
    // an outer variable during render is the side effect `react-hooks/globals`
    // forbids.
    function ShowProbe({ collapsed }: { collapsed: boolean }) {
      const { showTrailTerminal } = useWorkstationRailTrailTerminal({
        collapsed,
      });
      return React.createElement("span", null, String(showTrailTerminal));
    }
    act(() => {
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(ShowProbe, { collapsed: true })
        )
      );
    });
    expect(container.textContent).toBe("false");
  });
});
