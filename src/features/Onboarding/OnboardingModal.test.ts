// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TUTORIALS } from "@src/scaffold/Tutorials/tutorialRegistry";

import OnboardingModal from "./OnboardingModal";

const actions = vi.hoisted(() => ({
  openCollabOrgSpotlight: vi.fn(),
  openSessionCreatorSpotlight: vi.fn(),
  openWorkingDirectorySpotlight: vi.fn(),
  openBranchSpotlight: vi.fn(),
}));
vi.mock("@src/scaffold/GlobalSpotlight/openSpotlight", () => actions);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("OnboardingModal", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    function Host() {
      const [open, setOpen] = useState(true);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "button",
          { onClick: () => setOpen(true), "data-testid": "reopen" },
          "Reopen"
        ),
        React.createElement(OnboardingModal, {
          open,
          onClose: () => setOpen(false),
        })
      );
    }
    act(() =>
      root.render(
        React.createElement(
          Provider,
          { store: createStore() },
          React.createElement(Host)
        )
      )
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.resetAllMocks();
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  });
  function click(id: string) {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-testid="${id}"]`
    );
    expect(button?.tagName).toBe("BUTTON");
    act(() => button!.click());
  }
  it("does not contain the wiki", () => {
    expect(document.querySelector('[aria-label="Search the wiki"]')).toBeNull();
  });
  it.each([
    ["onboarding-start-session", "openSessionCreatorSpotlight", []],
    [
      "onboarding-working-directories",
      "openWorkingDirectorySpotlight",
      ["switch"],
    ],
    ["onboarding-workspace", "openCollabOrgSpotlight", []],
    [
      "onboarding-feature-spotlight-repository-branches",
      "openBranchSpotlight",
      [],
    ],
  ] as const)("closes the modal before launching %s", (id, action, args) => {
    actions[action].mockImplementation(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    click(id);
    expect(actions[action]).toHaveBeenCalledOnce();
    expect(actions[action]).toHaveBeenCalledWith(...args);
  });
  it.each(TUTORIALS)("launches the $id tour after closing", (tutorial) => {
    const listener = vi.fn(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    );
    window.addEventListener(tutorial.eventName, listener);
    try {
      click(`onboarding-tour-${tutorial.id}`);
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(tutorial.eventName, listener);
    }
  });
  it("can be dismissed with Escape and reopened with all cards available", () => {
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click("reopen");
    expect(
      document.querySelector('[data-testid="onboarding-start-session"]')
    ).not.toBeNull();
    expect(
      document.querySelector(
        '[data-testid="onboarding-feature-spotlight-repository-branches"]'
      )
    ).not.toBeNull();
  });
});
