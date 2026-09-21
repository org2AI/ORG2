// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import React, { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TUTORIALS } from "@src/scaffold/Tutorials/tutorialRegistry";

import WikiModal from "./WikiModal";

const mocks = vi.hoisted(() => ({ openLink: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@src/util/ui/openLink", () => ({ openLink: mocks.openLink }));

describe("WikiModal", () => {
  let root: Root;
  let container: HTMLDivElement;
  function render(showTutorials: boolean) {
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
        React.createElement(WikiModal, {
          open,
          onClose: () => setOpen(false),
          showTutorials,
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
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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
  it("uses the shared image-modal treatment with decorative onboarding artwork", () => {
    render(true);
    const image = document.querySelector<HTMLImageElement>(
      ".liquid-modal-image"
    );

    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toContain("onboarding.png");
    expect(image?.getAttribute("alt")).toBe("");
  });
  it("stacks the wiki and the tours as sections", () => {
    render(true);

    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="wiki-section-"]')
    ).map((section) => section.dataset.testid);

    expect(sections).toEqual(["wiki-section-wiki", "wiki-section-tutorials"]);
    expect(
      document.querySelector('[data-testid="wiki-open-link"]')
    ).not.toBeNull();
    for (const tutorial of TUTORIALS) {
      expect(
        document.querySelector(`[data-testid="onboarding-tour-${tutorial.id}"]`)
      ).not.toBeNull();
    }
  });
  it("titles each section", () => {
    render(true);
    const headings = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"] h2')
    ).map((heading) => heading.textContent);

    expect(headings).toEqual(["Wiki", "discovery.getStarted"]);
  });
  it("opens the hosted wiki after closing the dialog", () => {
    render(true);
    click("wiki-open-link");

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.openLink).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/org2AI/ORG2/wiki",
      { navigate: true }
    );
  });
  it("keeps the wiki section and drops the tours outside dev mode", () => {
    render(false);

    expect(
      document.querySelector('[data-testid="wiki-section-tutorials"]')
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="wiki-section-wiki"]')
    ).not.toBeNull();
    for (const tutorial of TUTORIALS) {
      expect(
        document.querySelector(`[data-testid="onboarding-tour-${tutorial.id}"]`)
      ).toBeNull();
    }
  });
  it.each(TUTORIALS)("launches the $id tour after closing", (tutorial) => {
    render(true);
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
  it("can be dismissed with Escape and reopened with both sections", () => {
    render(true);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    click("reopen");

    expect(
      document.querySelector('[data-testid="wiki-open-link"]')
    ).not.toBeNull();
    expect(
      document.querySelector(
        `[data-testid="onboarding-tour-${TUTORIALS[0].id}"]`
      )
    ).not.toBeNull();
  });
});
