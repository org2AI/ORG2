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
} from "vitest";

import SectionContainer from "../Container";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SectionContainer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT");
  });

  it("lets a standard title collapse and expand its card", () => {
    act(() => {
      root.render(
        React.createElement(
          SectionContainer,
          {
            title: "Advanced settings",
            collapsible: true,
            defaultOpen: false,
            titleButtonTestId: "advanced-toggle",
          } as React.ComponentProps<typeof SectionContainer>,
          React.createElement("span", null, "Advanced content")
        )
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="advanced-toggle"]'
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Advanced content");

    act(() => toggle?.click());

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Advanced content");
  });
});
