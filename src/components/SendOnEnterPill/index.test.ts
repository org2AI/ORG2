// @vitest-environment jsdom
import { act, createElement } from "react";
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

import SendOnEnterPill, { getSendOnEnterOptions } from ".";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

describe("SendOnEnterPill", () => {
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

  it("uses the platform shortcut label for the modifier option", () => {
    expect(getSendOnEnterOptions("mac").map(({ label }) => label)).toEqual([
      "Enter",
      "⌘ Enter",
    ]);
    expect(getSendOnEnterOptions("windows").map(({ label }) => label)).toEqual([
      "Enter",
      "Ctrl+Enter",
    ]);
    expect(getSendOnEnterOptions("linux").map(({ label }) => label)).toEqual([
      "Enter",
      "Ctrl+Enter",
    ]);
  });

  it("maps each selected segment back to the boolean preference", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        createElement(SendOnEnterPill, {
          ariaLabel: "Send messages with",
          onChange,
          sendOnEnter: false,
        })
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("true");

    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());

    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
});
