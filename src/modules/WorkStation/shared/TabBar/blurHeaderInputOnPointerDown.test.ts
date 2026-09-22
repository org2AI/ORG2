// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { blurHeaderInputOnPointerDown } from "./blurHeaderInputOnPointerDown";

afterEach(() => document.body.replaceChildren());

function setup(headerField = true) {
  const header = document.createElement("div");
  if (headerField) header.setAttribute("data-workstation-tab-header", "");
  const input = document.createElement("input");
  header.appendChild(input);
  const tabBar = document.createElement("div");
  const tab = document.createElement("button");
  tabBar.appendChild(tab);
  document.body.append(header, tabBar);
  tabBar.addEventListener(
    "pointerdown",
    (event) => {
      blurHeaderInputOnPointerDown({
        button: (event as MouseEvent).button,
        currentTarget: tabBar,
      });
    },
    true
  );
  input.focus();
  return { input, tabBar, tab };
}

function press(target: HTMLElement, button = 0) {
  target.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button })
  );
}

describe("tab strip header focus", () => {
  it.each(["search", "browser"])(
    "blurs the %s header field on empty tab-strip space",
    (kind) => {
      const { input, tabBar } = setup();
      input.setAttribute("aria-label", kind);
      press(tabBar);
      expect(document.activeElement).not.toBe(input);
    }
  );

  it("blurs before a tab control stops propagation without cancelling its action", () => {
    const { input, tab } = setup();
    const action = vi.fn((event: Event) => {
      expect(document.activeElement).not.toBe(input);
      expect(event.defaultPrevented).toBe(false);
      event.stopPropagation();
    });
    tab.addEventListener("pointerdown", action);
    press(tab);
    expect(action).toHaveBeenCalledOnce();
  });

  it.each([1, 2])("preserves focus for mouse button %s", (button) => {
    const { input, tabBar } = setup();
    press(tabBar, button);
    expect(document.activeElement).toBe(input);
  });

  it("leaves fields outside the workstation header alone", () => {
    const { input, tabBar } = setup(false);
    press(tabBar);
    expect(document.activeElement).toBe(input);
  });

  it("keeps focus while clicking within the header input", () => {
    const { input } = setup();
    press(input);
    expect(document.activeElement).toBe(input);
  });
});
