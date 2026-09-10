// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { TUTORIALS_OPEN_EVENT } from "@src/scaffold/Tutorials/tutorialRegistry";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

import OnboardingHost from "./OnboardingHost";

vi.mock("./OnboardingModal", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? React.createElement("div", { role: "dialog" }, "Onboarding") : null,
}));

it("ignores open events outside dev mode and resets on disabling dev mode", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = createStore();
  store.set(devModeEnabledAtom, false);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const open = () =>
    act(() => {
      window.dispatchEvent(new CustomEvent(TUTORIALS_OPEN_EVENT));
    });
  try {
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store },
          React.createElement(OnboardingHost)
        )
      )
    );
    open();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    act(() => store.set(devModeEnabledAtom, true));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    open();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => store.set(devModeEnabledAtom, false));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    open();
    act(() => store.set(devModeEnabledAtom, true));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    open();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
