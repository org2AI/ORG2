// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MobileRemotePlatformProvider } from "../../platform";
import { createBrowserMobileRemotePlatform } from "../../platform/browser";
import { MobileModelListDropdown } from "./MobileModelListDropdown";

vi.mock("@src/components/ModelIcon", () => ({
  default: () => React.createElement("svg"),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let anchor: HTMLButtonElement;
const platform = createBrowserMobileRemotePlatform();
const TestProvider = MobileRemotePlatformProvider as React.ComponentType<
  React.PropsWithChildren<{ platform: typeof platform }>
>;
const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);
const options = [
  { id: "gpt-5.6-sol", accountId: "a", accountLabel: "Account A" },
  { id: "gpt-5.6-sol", accountId: "b", accountLabel: "Account B" },
];
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(anchor, host);
  root = createRoot(host);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    x: 12,
    y: 600,
    top: 600,
    left: 12,
    bottom: 640,
    right: 180,
    width: 168,
    height: 40,
    toJSON: () => ({}),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  anchor.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
async function render(
  overrides: Partial<React.ComponentProps<typeof MobileModelListDropdown>> = {},
  settleFrames = true
) {
  await act(async () =>
    root.render(
      React.createElement(
        TestProvider,
        { platform },
        React.createElement(MobileModelListDropdown, {
          anchorRef: { current: anchor },
          open: true,
          onClose: vi.fn(),
          options,
          allOptions: [
            ...options,
            {
              id: "gpt-5.6-sol-high",
              accountId: "a",
              accountLabel: "Account A",
            },
          ],
          currentModelId: "gpt-5.6-sol-high",
          currentAccountId: "a",
          loadingLabel: "Loading models",
          emptyLabel: "No models",
          onSelect: vi.fn(),
          ...overrides,
        })
      )
    )
  );
  if (settleFrames) await act(async () => vi.advanceTimersByTimeAsync(64));
}

it("reuses selected model rows, preserves account/family selection and commits keyboard selection once", async () => {
  const onSelect = vi.fn();
  await render({ onSelect });
  const rows = document.querySelectorAll<HTMLElement>('[role="option"]');
  expect(rows).toHaveLength(2);
  expect(rows[0].tagName).toBe("DIV");
  expect(rows[0].getAttribute("aria-selected")).toBe("true");
  expect(rows[1].getAttribute("aria-selected")).toBe("false");
  expect(rows[0].querySelector('[data-icon="check"]')).not.toBeNull();
  const input = document.querySelector("input")!;
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
  );
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    )
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(options[0]);
});

it("blocks selection while patching and retains shared search, empty and close behavior", async () => {
  const onSelect = vi.fn();
  await render({ patching: true, onSelect });
  const row = document.querySelector<HTMLElement>('[role="option"]')!;
  expect(row.getAttribute("aria-disabled")).toBe("true");
  await act(async () => row.click());
  await act(async () =>
    document
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
  );
  expect(onSelect).not.toHaveBeenCalled();
  await render({ onSelect });
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "Account B");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  await act(async () =>
    document.querySelector<HTMLElement>('[role="option"]')!.click()
  );
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onSelect).toHaveBeenCalledWith(options[1]);
  await render({ options: [], loading: true });
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    "Loading models"
  );
  await render({ options: [], loading: false });
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain(
    "No models"
  );
  await render({ open: false });
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it("repositions an open intrinsic-width menu on resize without changing selection", async () => {
  const onSelect = vi.fn();
  await render({ onSelect });
  const panel = document.querySelector<HTMLElement>(".mobile-model-menu")!;
  expect(panel.style.width).toBe("");
  expect(
    panel.querySelector(".mobile-model-menu__label")?.textContent
  ).toContain("Account A");
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    x: 200,
    y: 200,
    top: 200,
    bottom: 344,
    left: 200,
    right: 456,
    width: 256,
    height: 144,
    toJSON: () => ({}),
  });
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    x: 240,
    y: 100,
    top: 100,
    bottom: 140,
    left: 240,
    right: 300,
    width: 60,
    height: 40,
    toJSON: () => ({}),
  });
  vi.stubGlobal("innerWidth", 320);
  vi.stubGlobal("innerHeight", 568);
  await act(async () => {
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(32);
  });
  expect(Number.parseFloat(panel.style.left) + 256).toBeLessThanOrEqual(320);
  expect(panel.style.top).not.toBe(""); // flips below the now-high anchor
  expect(
    document.querySelector('[aria-selected="true"]')?.textContent
  ).toContain("Account A");
  expect(onSelect).not.toHaveBeenCalled();
  await render({ open: false });
  expect(document.querySelector(".mobile-model-menu")).toBeNull();
});

it("clamps the first visible panel using its intrinsic width before animation frames", async () => {
  vi.stubGlobal("innerWidth", 320);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    x: 72,
    y: 600,
    top: 600,
    left: 72,
    bottom: 644,
    right: 203,
    width: 131,
    height: 44,
    toJSON: () => ({}),
  });
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (!this.classList.contains("mobile-model-menu"))
        return originalRect.call(this);
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: 200,
        right: 288,
        width: 288,
        height: 200,
        toJSON: () => ({}),
      };
    }
  );
  const onSelect = vi.fn();
  for (let openCount = 0; openCount < 2; openCount += 1) {
    await render({ onSelect }, false);
    const panel = document.querySelector<HTMLElement>(".mobile-model-menu")!;
    expect(panel.style.visibility).toBe("visible");
    expect(Number.parseFloat(panel.style.left)).toBe(24);
    expect(Number.parseFloat(panel.style.left) + 288).toBeLessThanOrEqual(320);
    expect(onSelect).not.toHaveBeenCalled();
    await render({ open: false, onSelect });
    expect(document.querySelector(".mobile-model-menu")).toBeNull();
  }
});
