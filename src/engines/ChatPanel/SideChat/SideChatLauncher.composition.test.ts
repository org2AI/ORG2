// @vitest-environment jsdom
import { Provider, createStore, useAtomValue } from "jotai";
import { type ReactNode, act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { FloatingLauncherStack } from "@src/components/FloatingWindow/FloatingLauncher";
import { WorkstationFloatingLauncher } from "@src/scaffold/WorkbenchChrome/WorkstationFloatingControls";
import {
  closeSideChatAtom,
  sideChatVisibleAtom,
} from "@src/store/ui/sideChatAtom";
import {
  collapseWorkstationAtom,
  workstationPresentationAtom,
} from "@src/store/workstation/presentationAtoms";

import ChatPanelSideChat from ".";

vi.mock("@src/store/chatPanel/chatPanelTabsState", async () => {
  const actual = await vi.importActual<
    typeof import("@src/store/chatPanel/chatPanelTabsState")
  >("@src/store/chatPanel/chatPanelTabsState");
  const { atom } = await import("jotai");
  return { ...actual, activeChatPanelTabTypeAtom: atom("github-issue") };
});
vi.mock("@src/components/FloatingWindow", () => ({ default: () => null }));
vi.mock("@src/util/platform/tauri/windowIdentity", () => ({
  isStationWindow: () => false,
}));

function Launchers() {
  const presentation = useAtomValue(workstationPresentationAtom);
  return createElement(ChatPanelSideChat, {
    renderFloatingLauncher: (launcher: ReactNode) =>
      createElement(
        FloatingLauncherStack,
        null,
        launcher,
        presentation === "collapsed"
          ? createElement(WorkstationFloatingLauncher)
          : null
      ),
  });
}

it("keeps independent actions in one stack through open, close and workstation restore", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  store.set(collapseWorkstationAtom);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const buttons = () =>
    Array.from(
      container.querySelectorAll("[data-floating-launcher-stack] button")
    ).map((button) => button.getAttribute("data-testid"));
  const click = (id: string) =>
    act(() =>
      container
        .querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!
        .click()
    );
  try {
    act(() =>
      root.render(createElement(Provider, { store }, createElement(Launchers)))
    );
    expect(buttons()).toEqual([
      "side-chat-floating-button",
      "workstation-expand",
    ]);
    const workstation = container.querySelector(
      '[data-testid="workstation-expand"]'
    );
    click("side-chat-floating-button");
    expect(store.get(sideChatVisibleAtom)).toBe(true);
    expect(buttons()).toEqual(["workstation-expand"]);
    expect(container.querySelector('[data-testid="workstation-expand"]')).toBe(
      workstation
    );
    act(() => store.set(closeSideChatAtom));
    expect(buttons()).toEqual([
      "side-chat-floating-button",
      "workstation-expand",
    ]);
    click("workstation-expand");
    expect(store.get(workstationPresentationAtom)).toBe("floating");
    expect(store.get(sideChatVisibleAtom)).toBe(false);
    expect(buttons()).toEqual(["side-chat-floating-button"]);
  } finally {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
